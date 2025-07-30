import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";
import moment from "moment-timezone"; // لاستخدام التوقيت العالمي المنسق UTC بدقة

// تحميل متغيرات البيئة من ملف .env
dotenv.config();

const app = express();

// تفعيل CORS لجميع المواقع
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === تعديل نهائي: إزالة لاحقة -latest من اسم الطراز ===
// هذا هو الاسم الصحيح الذي يتعرف عليه الـ API مباشرة
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent";

// ---------------------------------------------------
// متغيرات تتبع الحصص
// ---------------------------------------------------

// الحدود الصحيحة للطبقة المجانية لطراز 2.5 Pro
const QUOTA_LIMITS = {
  RPM: 5,       // الطلبات في الدقيقة (Requests Per Minute)
  TPM: 1000000, // التوكنات في الدقيقة (Tokens Per Minute - تقديري)
  RPD: 100,     // الطلبات في اليوم (Requests Per Day)
  TPD: 200000000 // التوكنات في اليوم (Tokens Per Day - تقديري)
};

// عدادات الاستخدام
let currentMinuteRequests = 0;
let currentMinuteTokens = 0;
let currentDailyRequests = 0;
let currentDailyTokens = 0;

// أوقات إعادة التعيين
let lastMinuteReset = moment.utc();
let lastDailyReset = moment.utc().startOf('day'); // بداية اليوم بتوقيت UTC

// ---------------------------------------------------
// دالة مساعدة لإعادة تعيين العدادات وتحديثها
// ---------------------------------------------------
function resetAndRefreshQuotas() {
  const now = moment.utc();

  // إعادة تعيين عدادات الدقيقة إذا مرت دقيقة
  if (now.diff(lastMinuteReset, 'seconds') >= 60) {
    currentMinuteRequests = 0;
    currentMinuteTokens = 0;
    lastMinuteReset = now;
  }

  // إعادة تعيين عدادات اليوم إذا تغير اليوم (منتصف الليل بتوقيت UTC)
  if (now.isAfter(lastDailyReset.clone().endOf('day'))) { // إذا تجاوزنا نهاية اليوم السابق
    currentDailyRequests = 0;
    currentDailyTokens = 0;
    lastDailyReset = now.startOf('day');
  }
}

// ---------------------------------------------------
// نقطة النهاية لمعالجة طلبات Gemini
// ---------------------------------------------------
app.post("/api/gemini", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt مطلوب.", type: "missing_prompt" });
  }

  resetAndRefreshQuotas();

  // التحقق من حد الطلبات في الدقيقة (RPM)
  if (currentMinuteRequests >= QUOTA_LIMITS.RPM) {
    return res.status(429).json({
      error: "لقد تجاوزت الحد المسموح به من الطلبات في الدقيقة.",
      type: "minute_requests_exceeded"
    });
  }

  // التحقق من حد الطلبات في اليوم (RPD)
  if (currentDailyRequests >= QUOTA_LIMITS.RPD) {
    return res.status(429).json({
      error: "لقد تجاوزت الحد اليومي المسموح به من الطلبات.",
      type: "daily_requests_exceeded"
    });
  }

  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ]
      },
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "لا يوجد رد من Gemini.";

    const promptTokenCount = response.data?.usageMetadata?.promptTokenCount || 0;
    const candidatesTokenCount = response.data?.usageMetadata?.candidatesTokenCount || 0;
    const totalTokensUsed = promptTokenCount + candidatesTokenCount;

    currentMinuteRequests++;
    currentMinuteTokens += totalTokensUsed;
    currentDailyRequests++;
    currentDailyTokens += totalTokensUsed;

    let warningMessage = null;
    let warningType = null;

    if (currentMinuteTokens > QUOTA_LIMITS.TPM) {
        warningMessage = "تحذير: تجاوزت حد التوكنات في الدقيقة.";
        warningType = "minute_tokens_warning";
        console.warn(warningMessage + ` الاستخدام الحالي: ${currentMinuteTokens}، الحد: ${QUOTA_LIMITS.TPM}`);
    }
    if (currentDailyTokens > QUOTA_LIMITS.TPD) {
        warningMessage = (warningMessage ? warningMessage + " و" : "") + "تحذير: تجاوزت حد التوكنات في اليوم.";
        warningType = (warningType ? warningType + "_daily_tokens_warning" : "daily_tokens_warning");
        console.warn(warningMessage + ` الاستخدام الحالي: ${currentDailyTokens}، الحد: ${QUOTA_LIMITS.TPD}`);
    }

    res.json({ response: result, type: "success", warning: warningMessage, warningType: warningType });

  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.error?.message?.toLowerCase() || "";

    console.error("خطأ في الاتصال بـ Gemini:", message || err.message);

    const quotaMessages = [
      "resource has been exhausted",
      "you exceeded your current quota",
      "quota exceeded",
      "quota exceeded: tokenspermonth",
      "the request was blocked due to quota limits",
      "billing account not configured",
      "project has exceeded its quota limits"
    ];

    const isQuotaError = status === 429 && quotaMessages.some(m => message.includes(m));

    if (isQuotaError) {
      resetAndRefreshQuotas();

      if (currentDailyRequests >= QUOTA_LIMITS.RPD) {
        return res.status(429).json({
          error: "لقد تجاوزت الحد اليومي المسموح به من الطلبات.",
          type: "daily_requests_exceeded"
        });
      }
      if (currentDailyTokens >= QUOTA_LIMITS.TPD) {
        return res.status(429).json({
          error: "لقد تجاوزت الحد اليومي المسموح به من التوكنات.",
          type: "daily_tokens_exceeded"
        });
      }
      if (currentMinuteRequests >= QUOTA_LIMITS.RPM) {
        return res.status(429).json({
          error: "لقد تجاوزت الحد المسموح به من الطلبات في الدقيقة.",
          type: "minute_requests_exceeded"
        });
      }
      if (currentMinuteTokens >= QUOTA_LIMITS.TPM) {
        return res.status(429).json({
          error: "لقد تجاوزت الحد المسموح به من التوكنات في الدقيقة.",
          type: "minute_tokens_exceeded"
        });
      }
      
      return res.status(429).json({
        error: "تم تجاوز حصة Gemini API. يرجى المحاولة لاحقًا.",
        type: "generic_quota_exceeded"
      });
    }

    res.status(500).json({ error: "فشل الاتصال مع Gemini API أو خطأ داخلي في الخادم.", type: "server_error" });
  }
});

// منفذ التشغيل
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
  // رسالة التأكيد المحدثة
  console.log(`🚀 يستهدف طراز: ${GEMINI_API_URL}`);
});
