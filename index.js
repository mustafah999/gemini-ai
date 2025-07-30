import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import moment from "moment-timezone";

dotenv.config();

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";

const QUOTA_LIMITS = {
  RPM: 5,
  TPM: 1000000,
  RPD: 100,
  TPD: 200000000
};

let currentMinuteRequests = 0;
let currentMinuteTokens = 0;
let currentDailyRequests = 0;
let currentDailyTokens = 0;

let lastMinuteReset = moment.utc();
let lastDailyReset = moment.utc().startOf('day');

function resetAndRefreshQuotas() {
  const now = moment.utc();
  if (now.diff(lastMinuteReset, 'seconds') >= 60) {
    currentMinuteRequests = 0;
    currentMinuteTokens = 0;
    lastMinuteReset = now;
  }
  if (now.isAfter(lastDailyReset.clone().endOf('day'))) {
    currentDailyRequests = 0;
    currentDailyTokens = 0;
    lastDailyReset = now.startOf('day');
  }
}

app.post("/api/gemini", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Prompt مطلوب.", type: "missing_prompt" });
  }
  resetAndRefreshQuotas();
  if (currentMinuteRequests >= QUOTA_LIMITS.RPM) {
    return res.status(429).json({ error: "لقد تجاوزت الحد المسموح به من الطلبات في الدقيقة.", type: "minute_requests_exceeded" });
  }
  if (currentDailyRequests >= QUOTA_LIMITS.RPD) {
    return res.status(429).json({ error: "لقد تجاوزت الحد اليومي المسموح به من الطلبات.", type: "daily_requests_exceeded" });
  }
  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { "Content-Type": "application/json" } }
    );
    const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "لا يوجد رد من Gemini.";
    const promptTokenCount = response.data?.usageMetadata?.promptTokenCount || 0;
    const candidatesTokenCount = response.data?.usageMetadata?.candidatesTokenCount || 0;
    const totalTokensUsed = promptTokenCount + candidatesTokenCount;
    currentMinuteRequests++;
    currentMinuteTokens += totalTokensUsed;
    currentDailyRequests++;
    currentDailyTokens += totalTokensUsed;
    res.json({ response: result, type: "success" });
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.error?.message?.toLowerCase() || "";
    console.error("خطأ في الاتصال بـ Gemini:", message || err.message);
    const quotaMessages = ["resource has been exhausted", "you exceeded your current quota", "quota exceeded", "the request was blocked due to quota limits"];
    const isQuotaError = status === 429 && quotaMessages.some(m => message.includes(m));
    if (isQuotaError) {
      return res.status(429).json({ error: "تم تجاوز حصة Gemini API. يرجى المحاولة لاحقًا.", type: "generic_quota_exceeded" });
    }
    res.status(500).json({ error: "فشل الاتصال مع Gemini API أو خطأ داخلي في الخادم.", type: "server_error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
  console.log(`🚀 يستهدف طراز: ${GEMINI_API_URL}`);
});
