'use strict';

const {randomUUID} = require('crypto');
const {generateSignedHeaders} = require('./awsSign');

var dorita980 = async function (user, password) {
  if (!user) throw new Error('username is required.');
  if (!password) throw new Error('password is required.');

  const form = (obj) => new URLSearchParams(obj).toString();

  let config = {
    appId: randomUUID(),
    deviceId: randomUUID()
  };

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'iRobot/7.16.2.140449 CFNetwork/1568.100.1.2.1 Darwin/24.0.0'
  };

  const discoveryUrl = 'https://disc-prod.iot.irobotapi.com/v1/discover/endpoints?country_code=US';
  const endpoints = await fetch(discoveryUrl)
    .then((r) => r.json())
    .catch((e) => {
      throw new error('Failed to discover URLS: ' + e);
    });

  const gigya = endpoints.gigya;
  const deployment = endpoints.deployments[endpoints.current_deployment];
  const apiKey = gigya.api_key;
  const baseAcc = `https://accounts.${gigya.datacenter_domain}/accounts.`;

  const loginRes = await fetch(`${baseAcc}login`, {
    method: 'POST',
    headers,
    body: form({
      loginMode: 'standard',
      loginID: user,
      password: password,
      includeUserInfo: true,
      targetEnv: 'mobile',
      source: 'showScreenSet',
      sdk: 'ios_swift_1.3.0',
      include: 'profile,data,emails,subscriptions,preferences,devices',
      sessionExpiration: '-2',
      apikey: apiKey
    })
  }).then((r) => r.json());

  if (loginRes.errorCode !== 0) {
    throw new Error('Failed to login: ' + loginRes);
  }

  const { UID, UIDSignature, signatureTimestamp } = loginRes;

  const accInfoRes = await fetch(`${deployment.httpBase}/v2/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      app_id: `IOS-${config.appId}`,
      app_info: {
        device_id: `IOS-${config.deviceId}`,
        device_name: 'iPhone',
        language: 'en_US',
        version: '7.16.2'
      },
      assume_robot_ownership: '0',
      authorizer_params: {
        devices_per_token: 1200
      },
      gigya: {
        signature: UIDSignature,
        timestamp: signatureTimestamp,
        uid: UID
      },
      multiple_authorizer_token_support: true,
      push_info: {
        platform: 'APNS',
        push_token:
          'eb6ce9172e5fde9fe4c9a2a945b35709f73fb8014eb7449d944c6c89eeb472fb',
        supported_push_types: [
          'mkt_mca',
          'cr',
          'cse',
          'bf',
          'uota',
          'crae',
          'ae',
          'crbf',
          'pm',
          'teom',
          'te',
          'dt',
          'tr',
          'ir',
          'mca',
          'mca_pn_hd',
          'shcp',
          'shar',
          'shas',
          'scs',
          'lv',
          'ce',
          'ri',
          'fu'
        ]
      },
      skip_ownership_check: '0'
    })
  }).then((r) => r.json());
  if (accInfoRes.errorType == 'AspenError.AuthenticationFailed') {
    let exitMessage = 'Failed to login: ';
    if (accInfoRes.errorMessage.toLowerCase().includes('no mqtt slot')) {
      exitMessage = 'Failed to login - rate limited: ';
    }
    throw new Error(exitMessage + accInfoRes.errorMessage);
  }
  if (accInfoRes.errorCode) {
    throw new Error('Failed to fetch account information: ' + accInfoRes);
  }

  async function awsRequestTo (url, parameters, credentials) {
    const region = credentials.CognitoId.split(':')[0];
    const reqUrl = new URL(url);
    reqUrl.search = new URLSearchParams(parameters).toString();
    const req = await fetch(reqUrl, {
      headers: generateSignedHeaders({
        method: 'GET',
        service: 'execute-api',
        region,
        host: reqUrl.host,
        path: reqUrl.pathname,
        queryParams: parameters,
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretKey,
        sessionToken: credentials.SessionToken,
        payload: '',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': 'aws-sdk-iOS/2.27.6 iOS/18.0.1 en_US'
        }
      })
    }).then((res) => res.json());
    return req;
  }
  let robotBlid;
  function setBLID (blid) {
    robotBlid = blid;
  }

  async function _fetch (url, params) {
    return await awsRequestTo(
      url,
      params,
      accInfoRes.credentials
    );
  }

  let pmapListing = await _fetch(`${deployment.httpBaseAuth}/v1/${robotBlid}/pmaps`, {visible: true, activeDetails: 2});

  async function connectToRobot (blid, password) {

  }

  async function getPMapList () {
    pmapListing = await _fetch(`${deployment.httpBaseAuth}/v1/${robotBlid}/pmaps`, {visible: true, activeDetails: 2});
    return pmapListing;
  }

  async function getPMap (pmapId) {
    const pmapMeta = await _fetch(
      `${deployment.httpBaseAuth}/v1/${robotBlid}/pmaps/${pmapId}`,
      {
        activeDetails: 2
      }
    );

    return {
      metadata: pmapMeta,
      getUMF: (pmapVersion = pmapMeta.active_pmapv_id) => { return getPMapUMF(pmapId, pmapVersion); }
    };
  }

  /**
   * UMF stands for Unifying Local and Global Multi-modal Features. This gives you the entire map view, as if you were the mobile app.
   * @param {*} pmapVersion The current mapping version (defaults to active version)
   * @returns A map of the floor on the current version.
   */
  async function getPMapUMF (pmapId, pmapVersion = null) {
    let version = pmapVersion;
    if (pmapVersion == null) {
      version = (await getPMap(pmapId)).active_pmapv_id;
    }
    const umf = await _fetch(
      `${deployment.httpBaseAuth}/v1/${robotBlid}/pmaps/${pmapId}/versions/${version}/umf`,
      {
        activeDetails: 2
      }
    );
    return umf;
  }

  return {
    account: accInfoRes,
    setBLID,
    getPMap,
    getPMapList,
    getPMapUMF,
    connectToRobot
  };
};

module.exports = dorita980;
