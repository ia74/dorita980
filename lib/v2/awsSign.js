import crypto from 'crypto';

function hmac (key, data, encoding) {
  const h = crypto.createHmac('sha256', key).update(data);
  return encoding ? h.digest(encoding) : h.digest();
}

function sha256 (data, encoding = 'hex') {
  return crypto.createHash('sha256').update(data).digest(encoding);
}

function getSignatureKey (key, dateStamp, regionName, serviceName) {
  const kDate = hmac('AWS4' + key, dateStamp);
  const kRegion = hmac(kDate, regionName);
  const kService = hmac(kRegion, serviceName);
  const kSigning = hmac(kService, 'aws4_request');
  return kSigning;
}

function getDateStamp (date = new Date()) {
  const yyyy = date.getUTCFullYear().toString();
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function getAmzDate (date = new Date()) {
  const yyyy = date.getUTCFullYear().toString();
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const min = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
}

/**
 * Generate AWS SigV4 signed headers for a request
 * @param {Object} options
 * @param {string} options.method - HTTP method (GET, POST, etc)
 * @param {string} options.service - AWS service name (e.g. "s3")
 * @param {string} options.region - AWS region (e.g. "us-east-1")
 * @param {string} options.host - Host header value (e.g. "bucket.s3.amazonaws.com")
 * @param {string} options.path - Request path (e.g. "/myobject")
 * @param {Object} options.queryParams - Object of query parameters (e.g. {list-type: "2"})
 * @param {Object} options.headers - Additional headers (e.g. {"Content-Type": "application/json"})
 * @param {string} options.payload - Request payload string (body), use "" for GET/no body
 * @param {string} options.accessKeyId - AWS Access Key ID
 * @param {string} options.secretAccessKey - AWS Secret Access Key
 * @param {string} [options.sessionToken] - Optional session token (for temporary credentials)
 * @returns {Object} headers to add to the HTTP request
 */
export function generateSignedHeaders ({
  method,
  service,
  region,
  host,
  path,
  queryParams = {},
  headers = {},
  payload = '',
  accessKeyId,
  secretAccessKey,
  sessionToken
}) {
  const now = new Date();
  const amzDate = getAmzDate(now);
  const dateStamp = getDateStamp(now);

  const httpMethod = method.toUpperCase();
  const canonicalUri = encodeURI(path);

  const sortedQueryKeys = Object.keys(queryParams).sort();
  const canonicalQueryString = sortedQueryKeys
    .map(
      (key) =>
        encodeURIComponent(key) + '=' + encodeURIComponent(queryParams[key])
    )
    .join('&');

  const mergedHeaders = {
    host,
    'x-amz-date': amzDate,
    ...headers
  };

  const sortedHeaderKeys = Object.keys(mergedHeaders)
    .map((k) => k.toLowerCase())
    .sort();

  let canonicalHeaders = '';
  let signedHeadersArr = [];
  for (const key of sortedHeaderKeys) {
    canonicalHeaders +=
      key + ':' + mergedHeaders[key] + '\n';
    signedHeadersArr.push(key);
  }
  const signedHeaders = signedHeadersArr.join(';');
  const payloadHash = sha256(payload);

  const canonicalRequest = [
    httpMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = sha256(canonicalRequest);

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join('\n');

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');

  const authorizationHeader = [
    `${algorithm} Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(', ');

  const finalHeaders = {
    ...mergedHeaders,
    Authorization: authorizationHeader
  };

  if (sessionToken) {
    finalHeaders['x-amz-security-token'] = sessionToken;
  }

  return finalHeaders;
}
