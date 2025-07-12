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

// رابط API الخاص بـ Gemini Flash
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// ---------------------------------------------------
// متغيرات تتبع الحصص (مؤقتة في الذاكرة - ليست مثالية للإنتاج الكبير بدون قاعدة بيانات)
// هذه المتغيرات ستُعاد تعيينها عند إعادة تشغيل الخادم.
// ---------------------------------------------------

// حدود Gemini 2.0 Flash المجاني (اعتبارًا من يوليو 2025 - قد تتغير)
const QUOTA_LIMITS = {
  RPM: 15, // Requests Per Minute - الطلبات في الدقيقة
  TPM: 1000000, // Tokens Per Minute - التوكنات في الدقيقة
  RPD: 200, // Requests Per Day - الطلبات في اليوم
  TPD: 200000000 // Tokens Per Day - التوكنات في اليوم (200 طلب * 1 مليون توكن/طلب كحد أقصى)
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

  // التأكد من وجود البرومبت
  if (!prompt) {
    return res.status(400).json({ error: "Prompt مطلوب.", type: "missing_prompt" });
  }

  // إعادة تعيين العدادات قبل كل طلب للتحقق من الحصص
  resetAndRefreshQuotas();

  // ---------------------------------------------------
  // التحقق من الحصص الداخلية قبل إرسال الطلب إلى Gemini API
  // هذا يساعد على إعطاء رسالة خطأ مبكرة وواضحة للمستخدم
  // ---------------------------------------------------

  // التحقق من حد الطلبات في الدقيقة (RPM)
  if (currentMinuteRequests >= QUOTA_LIMITS.RPM) {
    return res.status(429).json({
      error: "لقد تجاوزت الحد المسموح به من الطلبات في الدقيقة.",
      type: "minute_requests_exceeded"
    });
  }

  // التحقق من حد التوكنات في الدقيقة (TPM)
  // لا يمكننا معرفة عدد توكنات الإدخال بالضبط إلا بعد إرسالها،
  // ولكن يمكننا التحقق من الحد الإجمالي للتوكنات بعد الاستجابة.
  // للتبسيط، سنفترض أن الطلب الواحد لن يتجاوز TPM بشكل كبير قبل إرساله،
  // وسنركز على التتبع الدقيق بعد استجابة API.

  // التحقق من حد الطلبات في اليوم (RPD)
  if (currentDailyRequests >= QUOTA_LIMITS.RPD) {
    return res.status(429).json({
      error: "لقد تجاوزت الحد اليومي المسموح به من الطلبات.",
      type: "daily_requests_exceeded"
    });
  }

  // التحقق من حد التوكنات في اليوم (TPD)
  // نفس ملاحظة TPM تنطبق هنا.

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

    // ---------------------------------------------------
    // تحديث العدادات بعد استجابة ناجحة من Gemini API
    // ---------------------------------------------------
    const promptTokenCount = response.data?.usageMetadata?.promptTokenCount || 0;
    const candidatesTokenCount = response.data?.usageMetadata?.candidatesTokenCount || 0;
    const totalTokensUsed = promptTokenCount + candidatesTokenCount;

    currentMinuteRequests++;
    currentMinuteTokens += totalTokensUsed;
    currentDailyRequests++;
    currentDailyTokens += totalTokensUsed;

    // ---------------------------------------------------
    // التحقق من تجاوز التوكنات بعد الاستجابة (إذا لم يتم تجاوزها مسبقاً)
    // هذا مهم لأننا لا نعرف عدد التوكنات بالضبط قبل الطلب
    // ---------------------------------------------------
    let warningMessage = null;
    let warningType = null;

    if (currentMinuteTokens > QUOTA_LIMITS.TPM) {
        warningMessage = "تحذير: تجاوزت حد التوكنات في الدقيقة.";
        warningType = "minute_tokens_warning"; // يمكن أن يكون تحذيرًا بدلاً من خطأ صريح
        console.warn(warningMessage + ` الاستخدام الحالي: ${currentMinuteTokens}، الحد: ${QUOTA_LIMITS.TPM}`);
    }
    if (currentDailyTokens > QUOTA_LIMITS.TPD) {
        warningMessage = (warningMessage ? warningMessage + " و" : "") + "تحذير: تجاوزت حد التوكنات في اليوم.";
        warningType = (warningType ? warningType + "_daily_tokens_warning" : "daily_tokens_warning");
        console.warn(warningMessage + ` الاستخدام الحالي: ${currentDailyTokens}، الحد: ${QUOTA_LIMITS.TPD}`);
    }

    // إرسال الاستجابة الناجحة إلى الواجهة الأمامية، مع أي تحذيرات
    res.json({ response: result, type: "success", warning: warningMessage, warningType: warningType });

  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.error?.message?.toLowerCase() || "";

    console.error("خطأ في الاتصال بـ Gemini:", message || err.message);

    // قائمة بالرسائل التي تدل على انتهاء الحصة من Gemini API
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
      // ---------------------------------------------------
      // هنا نستخدم تتبعنا الداخلي لتحديد نوع خطأ الحصة بدقة أكبر
      // ---------------------------------------------------
      resetAndRefreshQuotas(); // إعادة تعيين العدادات للتأكد من أنها محدثة قبل الاستنتاج

      // التحقق من الحدود اليومية أولاً (لأنها الأقل تكرارًا في إعادة التعيين)
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
      // ثم التحقق من الحدود الدقائقية
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
      
      // إذا تلقينا 429 ولم يتم تجاوز أي من حدودنا الداخلية المعروفة،
      // فقد يكون ذلك بسبب حدود أخرى غير متوقعة أو تزامن.
      return res.status(429).json({
        error: "تم تجاوز حصة Gemini API. يرجى المحاولة لاحقًا.",
        type: "generic_quota_exceeded"
      });
    }

    // أخطاء أخرى غير متعلقة بالحصة
    res.status(500).json({ error: "فشل الاتصال مع Gemini API أو خطأ داخلي في الخادم.", type: "server_error" });
  }
});

// منفذ التشغيل
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
});

