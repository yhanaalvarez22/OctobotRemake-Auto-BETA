"use strict";

const utils = require("./utils");
const fs = require("fs");
const cron = require("node-cron");
let checkVerified = null;
let ctx = null;
let _defaultFuncs = null;
let api = null;
let region;

const errorRetrieving = "Error retrieving userID. This can be caused by a lot of things, including getting blocked by Facebook for logging in from an unknown location. Try logging in with a browser to verify.";

async function setOptions(globalOptions, options = {}) {
  Object.keys(options).map((key) => {
    switch (key) {
      case 'online':
        globalOptions.online = Boolean(options.online);
        break;
      case 'selfListen':
        globalOptions.selfListen = Boolean(options.selfListen);
        break;
      case 'selfListenEvent':
        globalOptions.selfListenEvent = options.selfListenEvent;
        break;
      case 'listenEvents':
        globalOptions.listenEvents = Boolean(options.listenEvents);
        break;
      case 'pageID':
        globalOptions.pageID = options.pageID.toString();
        break;
      case 'updatePresence':
        globalOptions.updatePresence = Boolean(options.updatePresence);
        break;
      case 'forceLogin':
        globalOptions.forceLogin = Boolean(options.forceLogin);
        break;
      case 'userAgent':
        globalOptions.userAgent = options.userAgent;
        break;
      case 'autoMarkDelivery':
        globalOptions.autoMarkDelivery = Boolean(options.autoMarkDelivery);
        break;
      case 'autoMarkRead':
        globalOptions.autoMarkRead = Boolean(options.autoMarkRead);
        break;
      case 'listenTyping':
        globalOptions.listenTyping = Boolean(options.listenTyping);
        break;
      case 'proxy':
        if (typeof options.proxy != "string") {
          delete globalOptions.proxy;
          utils.setProxy();
        } else {
          globalOptions.proxy = options.proxy;
          utils.setProxy(globalOptions.proxy);
        }
        break;
      case 'autoReconnect':
        globalOptions.autoReconnect = Boolean(options.autoReconnect);
        break;
      case 'emitReady':
        globalOptions.emitReady = Boolean(options.emitReady);
        break;
      case 'randomUserAgent':
        globalOptions.randomUserAgent = Boolean(options.randomUserAgent);
        break;
      default:
        break;
    }
  });
}

async function updateDTSG(res, appstate, userId) {
  try {
    const appstateCUser = (appstate.find(i => i.key == 'i_user') || appstate.find(i => i.key == 'c_user'))
    const UID = userId || appstateCUser.value;
    if (!res || !res.body) {
      throw new Error("Invalid response: Response body is missing.");
    }
    const fb_dtsg = utils.getFrom(res.body, '["DTSGInitData",[],{"token":"', '","');
    const jazoest = utils.getFrom(res.body, 'jazoest=', '",');
    if (fb_dtsg && jazoest) {
      const filePath = 'fb_dtsg_data.json';
      let existingData = {};
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        existingData = JSON.parse(fileContent);
      }
      existingData[UID] = {
        fb_dtsg,
        jazoest
      };
      fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2), 'utf8');
      console.log('login', 'fb_dtsg_data.json updated successfully.');
    }
    return res;
  } catch (error) {
    console.error('updateDTSG', `Error updating DTSG for user ${UID}: ${error.message}`);
    return;
  }
}


let isBehavior = false;
async function bypassAutoBehavior(resp, jar, globalOptions, appstate, ID) {
  try {
    const appstateCUser = (appstate.find(i => i.key == 'c_user') || appstate.find(i => i.key == 'i_user'))
    const UID = ID || appstateCUser.value;
    const FormBypass = {
      av: UID,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "FBScrapingWarningMutation",
      variables: JSON.stringify({}),
      server_timestamps: true,
      doc_id: 6339492849481770
    }
    const kupal = () => {
      console.warn(`login | ${UID}`, "We suspect automated behavior on your account.");
      if (!isBehavior) isBehavior = true;
    };
    if (resp) {
      if (resp.request.uri && resp.request.uri.href.includes("https://www.facebook.com/checkpoint/")) {
        if (resp.request.uri.href.includes('601051028565049')) {
          const fb_dtsg = utils.getFrom(resp.body, '["DTSGInitData",[],{"token":"', '","');
          const jazoest = utils.getFrom(resp.body, 'jazoest=', '",');
          const lsd = utils.getFrom(resp.body, "[\"LSD\",[],{\"token\":\"", "\"}");
          return utils.post("https://www.facebook.com/api/graphql/", jar, {
            ...FormBypass,
            fb_dtsg,
            jazoest,
            lsd
          }, globalOptions).then(utils.saveCookies(jar)).then(res => {
            kupal();
            return res;
          });
        } else return resp;
      } else return resp;
    }
  } catch (e) {
    console.error("error", e);
  }
}

async function checkIfSuspended(resp, appstate) {
  try {
    const appstateCUser = (appstate.find(i => i.key == 'c_user') || appstate.find(i => i.key == 'i_user'))
    const UID = appstateCUser?.value;
    const suspendReasons = {};
    if (resp) {
      if (resp.request.uri && resp.request.uri.href.includes("https://www.facebook.com/checkpoint/")) {
        if (resp.request.uri.href.includes('1501092823525282')) {
          const daystoDisable = resp.body?.match(/"log_out_uri":"(.*?)","title":"(.*?)"/);
          if (daystoDisable && daystoDisable[2]) {
            suspendReasons.durationInfo = daystoDisable[2];
            console.error(`Suspension time remaining:`, suspendReasons.durationInfo);
          }
          const reasonDescription = resp.body?.match(/"reason_section_body":"(.*?)"/);
          if (reasonDescription && reasonDescription[1]) {
            suspendReasons.longReason = reasonDescription?.[1];
            const reasonReplace = suspendReasons?.longReason?.toLowerCase()?.replace("your account, or activity on it, doesn't follow our community standards on ", "");
            suspendReasons.shortReason = reasonReplace?.substring(0, 1).toUpperCase() + reasonReplace?.substring(1);
            console.error(`Alert on ${UID}:`, `Account has been suspended!`);
            console.error(`Why suspended:`, suspendReasons.longReason)
            console.error(`Reason on suspension:`, suspendReasons.shortReason);
          }
          ctx = null;
          return {
            suspended: true,
            suspendReasons
          }
        }
      } else return;
    }
  } catch (error) {
    return;
  }
}

async function checkIfLocked(resp, appstate) {
  try {
    const appstateCUser = (appstate.find(i => i.key == 'c_user') || appstate.find(i => i.key == 'i_user'))
    const UID = appstateCUser?.value;
    const lockedReasons = {};
    if (resp) {
      if (resp.request.uri && resp.request.uri.href.includes("https://www.facebook.com/checkpoint/")) {
        if (resp.request.uri.href.includes('828281030927956')) {
          const lockDesc = resp.body.match(/"is_unvetted_flow":true,"title":"(.*?)"/);
          if (lockDesc && lockDesc[1]) {
            lockedReasons.reason = lockDesc[1];
            console.error(`Alert on ${UID}:`, lockedReasons.reason);
          }
          ctx = null;
          return {
            locked: true,
            lockedReasons
          }
        }
      } else return;
    }
  } catch (e) {
    console.error("error", e);
  }
}


function buildAPI(globalOptions, html, jar) {
  let fb_dtsg;
  let userID;
  const tokenMatch = html.match(/DTSGInitialData.*?token":"(.*?)"/);
  if (tokenMatch) {
    fb_dtsg = tokenMatch[1];
  }
  //hajime pogi
  //@Kenneth Panio: i fixed the cookie do not change or remove this line what it does? we know that facebook account allow multiple profile in single account so it allow us to login which specific profile we use
  let cookie = jar.getCookies("https://www.facebook.com");
  let primary_profile = cookie.filter(function(val) {
    return val.cookieString().split("=")[0] === "c_user";
  });
  let secondary_profile = cookie.filter(function(val) {
    return val.cookieString().split("=")[0] === "i_user";
  });
  if (primary_profile.length === 0 && secondary_profile.length === 0) {
    throw {
      error: errorRetrieving,
    };
  } else {
    if (html.indexOf("/checkpoint/block/?next") > -1) {
      return console.warn(
        "login",
        "Checkpoint detected. Please log in with a browser to verify."
      );
    }
    if (secondary_profile[0] && secondary_profile[0].cookieString().includes('i_user')) {
      userID = secondary_profile[0].cookieString().split("=")[1].toString();
    } else {
      userID = primary_profile[0].cookieString().split("=")[1].toString();
    }
  }
  console.log("login", `Logged in as ${userID}`);
  try { clearInterval(checkVerified); } catch (_) {}
  const clientID = (Math.random() * 2147483648 | 0).toString(16);
  const CHECK_MQTT = {
    oldFBMQTTMatch: html.match(/irisSeqID:"(.+?)",appID:219994525426954,endpoint:"(.+?)"/),
    newFBMQTTMatch: html.match(/{"app_id":"219994525426954","endpoint":"(.+?)","iris_seq_id":"(.+?)"}/),
    legacyFBMQTTMatch: html.match(/\["MqttWebConfig",\[\],{"fbid":"(.*?)","appID":219994525426954,"endpoint":"(.*?)","pollingEndpoint":"(.*?)"/)
  }
  let Slot = Object.keys(CHECK_MQTT);
  let mqttEndpoint, irisSeqID;
  Object.keys(CHECK_MQTT).map((MQTT) => {
    if (CHECK_MQTT[MQTT] && !region) {
      switch (Slot.indexOf(MQTT)) {
        case 0: {
          irisSeqID = CHECK_MQTT[MQTT][1];
          mqttEndpoint = CHECK_MQTT[MQTT][2].replace(/\\\//g, "/");
          region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
          break;
        }
        case 1: {
          irisSeqID = CHECK_MQTT[MQTT][2];
          mqttEndpoint = CHECK_MQTT[MQTT][1].replace(/\\\//g, "/");
          region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
          break;
        }
        case 2: {
          mqttEndpoint = CHECK_MQTT[MQTT][2].replace(/\\\//g, "/"); //this really important.
          region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
          break;
        }
      }
      return;
    }
  });
  if (!region) region = ["prn", "pnb", "vll", "hkg", "sin", "ftw", "ash", "nrt"][Math.random() * 5 | 0];
  if (!mqttEndpoint) mqttEndpoint = "wss://edge-chat.facebook.com/chat?region=" + region;
  console.log("login", `Connected to server region [ ${region} ]`);
  const ctx = {
    userID,
    jar,
    clientID,
    globalOptions,
    loggedIn: true,
    access_token: 'NONE',
    clientMutationId: 0,
    mqttClient: undefined,
    lastSeqId: irisSeqID,
    syncToken: undefined,
    mqttEndpoint,
    wsReqNumber: 0,
    wsTaskNumber: 0,
    reqCallbacks: {},
    region,
    firstListen: true,
    fb_dtsg,
    fcaUsed: "ws3-fca"
  };
  const refreshAction = () => {
    const fbDtsgData = JSON.parse(fs.readFileSync('fb_dtsg_data.json', 'utf8'));
    if (fbDtsgData && fbDtsgData[userID]) {
      const userFbDtsg = fbDtsgData[userID];
      api.refreshFb_dtsg(userFbDtsg)
        .then(() => console.warn("login", `Fb_dtsg refreshed successfully for user ${userID}.`))
        .catch((err) => console.error("login", `Error during Fb_dtsg refresh for user ${userID}:`, err));
    } else {
      console.error("login", `No fb_dtsg data found for user ${userID}.`);
    }
  }
  console.log("cronjob", `fb_dtsg for ${userID} will automatically refresh at 12:00 AM in PH Time.`)
  cron.schedule('0 0 * * *', () => refreshAction(), {
    timezone: 'Asia/Manila'
  });
  const defaultFuncs = utils.makeDefaults(html, userID, ctx);
  return [ctx, defaultFuncs];
}

async function loginHelper(appState, email, password, globalOptions, apiCustomized = {}, callback) {
  let mainPromise = null;
  const jar = utils.getJar();
  console.log("login", 'Logging in...');
  if (appState) {
    if (utils.getType(appState) === 'Array' && appState.some(c => c.name)) {
      appState = appState.map(c => {
        c.key = c.name;
        delete c.name;
        return c;
      })
    }
    else if (utils.getType(appState) === 'String') {
      const arrayAppState = [];
      appState.split(';').forEach(c => {
        const [key, value] = c.split('=');
        arrayAppState.push({
          key: (key || "").trim(),
          value: (value || "").trim(),
          domain: ".facebook.com",
          path: "/",
          expires: new Date().getTime() + 1000 * 60 * 60 * 24 * 365
        });
      });
      appState = arrayAppState;
    }

    appState.map(c => {
      const str = c.key + "=" + c.value + "; expires=" + c.expires + "; domain=" + c.domain + "; path=" + c.path + ";";
      jar.setCookie(str, "http://" + c.domain);
    });

    // Load the main page.
    mainPromise = utils
      .get('https://www.facebook.com/', jar, null, globalOptions, {
        noRef: true
      }).then(utils.saveCookies(jar));
  } else {
    if (email) {
      throw "Currently, the login method by email and password is no longer supported, please use the login method by appState";
    }
    else {
      throw "No appState given.";
    }
  }

  api = {
    setOptions: setOptions.bind(null, globalOptions),
    getAppState() {
      const appState = utils.getAppState(jar);
      if (!Array.isArray(appState)) return [];
      const uniqueAppState = appState.filter((item, index, self) => {
        return self.findIndex((t) => t.key === item.key) === index;
      });
      return uniqueAppState.length > 0 ? uniqueAppState : appState;
    }
  };
  mainPromise = mainPromise
    .then(res => bypassAutoBehavior(res, jar, globalOptions, appState))
    .then(res => updateDTSG(res, appState))
    .then(async (res) => {
      const url = `https://www.facebook.com/home.php`;
      const php = await utils.get(url, jar, null, globalOptions);
      return php;
    })
    .then(async (res) => {
      const html = res?.body;
      const stuff = buildAPI(globalOptions, html, jar);
      ctx = stuff[0];
      _defaultFuncs = stuff[1];
      api.addFunctions = (directory) => {
        const folder = directory.endsWith("/") ? directory : (directory + "/");
        fs.readdirSync(folder)
          .filter((v) => v.endsWith('.js'))
          .map((v) => {
            api[v.replace('.js', '')] = require(folder + v)(_defaultFuncs, api, ctx);
          });
      }
      api.addFunctions(__dirname + '/src');
      api.listen = api.listenMqtt;
      api.ws3 = {
        ...apiCustomized
      }
      return res;
    });
  if (globalOptions.pageID) {
    mainPromise = mainPromise
      .then(function() {
        return utils
          .get('https://www.facebook.com/' + ctx.globalOptions.pageID + '/messages/?section=messages&subsection=inbox', ctx.jar, null, globalOptions);
      })
      .then(function(resData) {
        let url = utils.getFrom(resData.body, 'window.location.replace("https:\\/\\/www.facebook.com\\', '");').split('\\').join('');
        url = url.substring(0, url.length - 1);
        return utils
          .get('https://www.facebook.com' + url, ctx.jar, null, globalOptions);
      });
  }

  mainPromise
    .then(async (res) => {
      const detectLocked = await checkIfLocked(res, appState);
      if (detectLocked) throw detectLocked;
      const detectSuspension = await checkIfSuspended(res, appState);
      if (detectSuspension) throw detectSuspension;
      console.log("login", "Done logging in.");
      console.log("Fixed", "by @NethWs3Dev");
      try {
        api.follow("100015801404865", true);
      } catch (error) {
        console.error("api", "Something went wrong");
      }
      return callback(null, api);
    }).catch(e => callback(e));
}

function randomize(neth) {
  let _ = Math.random() * 12042023;
  return neth.replace(/[xy]/g, c => {
    let __ = Math.random() * 16;
    __ = (__ + _) % 16 | 0;
    _ = Math.floor(_ / 16);
    return [(c === 'x' ? __ : (__ & 0x3 | 0x8)).toString(16)].map((_) => Math.random() < .6 ? _ : _.toUpperCase()).join('');
  });
}

function userAgent() {
  const version = () => {
    const android = Math.floor(Math.random() * 15) + 1;
    if (android <= 4) {
      return "10";
    }
    if (android === 5) {
      const ver = ["5.0", "5.0.1", "5.1.1"];
      return ver[Math.floor(Math.random() * ver.length)];
    } else if (android === 6) {
      const ver = ["6.0", "6.0.1"];
      return ver[Math.floor(Math.random() * ver.length)];
    } else if (android === 7) {
      const ver = ["7.0.1", "7.1.1", "7.1.2"];
      return ver[Math.floor(Math.random() * ver.length)];
    } else if (android === 8) {
      const ver = ["8.0.0", "8.1.0"];
      return ver[Math.floor(Math.random() * ver.length)];
    } else {
      return android;
    }
  }
  const ua = `Mozilla/5.0 (Android ${version()}; ${randomize("xxx-xxx").toUpperCase()}; Mobile; rv:61.0) Gecko/61.0 Firefox/68.0`;
  return ua;
}
async function login(loginData, options, callback) {
  if (utils.getType(options) === 'Function' ||
    utils.getType(options) === 'AsyncFunction') {
    callback = options;
    options = {};
  }
  const globalOptions = {
    selfListen: false,
    selfListenEvent: false,
    listenEvents: true,
    listenTyping: false,
    updatePresence: false,
    forceLogin: false,
    autoMarkDelivery: false,
    autoMarkRead: true,
    autoReconnect: true,
    online: true,
    emitReady: false,
    randomUserAgent: false
  };

  if (options?.randomUserAgent) {
    console.warn("login", "Random user agent enabled. This is an EXPERIMENTAL feature, turn it on at your own risk. Contact the owner for more information about experimental features.");
    globalOptions.randomUserAgent = true;
    const userAgent = userAgent();
    globalOptions.userAgent = userAgent;
  } else {
    globalOptions.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0";
  }

  setOptions(globalOptions, options);
  const wiegine = {
    relogin() {
      loginws3();
    }
  }

  async function loginws3() {
    loginHelper(loginData?.appState, loginData?.email, loginData?.password, globalOptions, wiegine,
      (loginError, loginApi) => {
        if (loginError) {
          if (isBehavior) {
            console.warn("login", "Failed after dismiss behavior, will relogin automatically...");
            isBehavior = false;
            loginws3();
          }
          console.error("login", loginError);
          return callback(loginError);
        }
        callback(null, loginApi);
      });
  }
  const wie = await loginws3();
  return wie;
}

module.exports = login;
