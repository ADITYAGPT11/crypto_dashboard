require("dotenv").config();
const { SmartAPI } = require("smartapi-javascript");
const { TOTP } = require("totp-generator");

async function login() {
  const smart_api = new SmartAPI({
    api_key: process.env.VITE_ANGLEONE_API_KEY,
  });

  const { otp } = await TOTP.generate(process.env.VITE_ANGLEONE_TOTP_SECRET);

  const session = await smart_api.generateSession(
    process.env.VITE_ANGLEONE_CLIENT_CODE,
    process.env.VITE_ANGLEONE_MPIN,
    otp,
  );

  if (session.status !== true) {
    throw new Error(`Login failed: ${JSON.stringify(session)}`);
  }
  const { jwtToken, refreshToken, feedToken } = session.data;

  return { smart_api, jwtToken, refreshToken, feedToken };
}

login().catch(console.error);
