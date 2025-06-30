import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";

// تحميل متغيرات البيئة
dotenv.config();

const app = express();

// تفعيل CORS لجميع المواقع
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// رابط API الخاص بـ Gemini Flash
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// نقطة النهاية
app.post("/api/gemini", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "prompt مطلوب" });
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

    const result = response.data?.candidates?.?.content?.parts?.?.text |

| "ما في رد.";
    res.json({ response: result });

  } catch (err) {
    console.error("خطأ في الاتصال بـ Gemini:", err.response?.data |

| err.message);

    let isQuotaExceeded = false;
    let customMessage = "حدث خطأ غير متوقع.";
    let customCode = "UNKNOWN_ERROR";
    let httpStatus = 500; // قيمة افتراضية لرمز حالة HTTP

    if (err.response) {
      const statusCode = err.response.status;
      const errorData = err.response.data;
      const errorMessage = errorData?.error?.message |

| '';
      const errorStatus = errorData?.error?.status |

| '';

      httpStatus = statusCode; // نستخدم رمز حالة HTTP الفعلي من استجابة Gemini API

      // 1. التحقق الأساسي من انتهاء الحصة/حد المعدل (HTTP 429)
      // هذا هو المؤشر الأكثر مباشرة لانتهاء التوكنات أو تجاوز حدود الاستخدام [1, 2, 3]
      if (statusCode === 429) {
        if (errorStatus === "RESOURCE_EXHAUSTED" ||
            errorMessage.includes("Resource has been exhausted") ||
            errorMessage.includes("You exceeded your current quota")) {
          isQuotaExceeded = true;
          customCode = "QUOTA_EXCEEDED";
          customMessage = "عذراً، لقد انتهت التوكنات الشهرية المجانية أو تجاوزت حدود الاستخدام.";
        } else {
          // إذا كان 429 ولكن ليس بسبب استنفاد الموارد، فقد يكون حد معدل مؤقت آخر
          customCode = "RATE_LIMIT_TEMPORARY";
          customMessage = "تم تجاوز حد المعدل مؤقتاً. يرجى المحاولة لاحقاً.";
        }
      }
      // 2. مشاكل الفوترة/الطبقة المجانية (HTTP 400 FAILED_PRECONDITION)
      // هذه المشاكل تمنع الاستخدام فعلياً بسبب قيود الحصص/الطبقة المجانية [1]
      else if (statusCode === 400 && errorStatus === "FAILED_PRECONDITION") {
        if (errorMessage.includes("free tier is not available in your country") ||
            errorMessage.includes("Please enable billing on your project")) {
          isQuotaExceeded = true;
          customCode = "BILLING_REQUIRED_OR_GEO_RESTRICTED";
          customMessage = "الطبقة المجانية غير متاحة في بلدك أو الفوترة غير مفعلة. يرجى تفعيل الفوترة.";
        } else {
          // 400 آخر غير متعلق بالحصص
          customCode = "INVALID_REQUEST_ARGUMENT";
          customMessage = `خطأ في الطلب: ${errorMessage}`;
        }
      }
      // 3. مشاكل الأذونات/مشروع الحصة (HTTP 403 PERMISSION_DENIED)
      // هذه المشاكل تمنع الاستخدام بسبب إعدادات غير صحيحة تتعلق بالحصص أو المفتاح [1, 4]
      else if (statusCode === 403 && errorStatus === "PERMISSION_DENIED") {
        if (errorMessage.includes("API key doesn't have the required permissions") ||
            errorMessage.includes("No quota project set")) {
          isQuotaExceeded = true;
          customCode = "PERMISSION_DENIED_QUOTA_RELATED";
          customMessage = "مشكلة في مفتاح API أو إعدادات الفوترة/المشروع. يرجى التحقق من الأذونات.";
        } else {
          // 403 آخر غير متعلق بالحصص
          customCode = "PERMISSION_DENIED_GENERIC";
          customMessage = `خطأ في الأذونات: ${errorMessage}`;
        }
      }
      // 4. أي خطأ آخر من Gemini API لا يعني انتهاء التوكنات مباشرة
      else {
        customCode = "GEMINI_API_ERROR";
        customMessage = `خطأ من Gemini API: ${errorMessage |

| 'غير معروف'}`;
      }
    } else {
      // أخطاء الشبكة أو الأخطاء التي لا تحتوي على استجابة من الخادم
      customCode = "NETWORK_ERROR";
      customMessage = `خطأ في الشبكة أو الاتصال بالخادم: ${err.message}`;
    }

    // إرسال الاستجابة النهائية للواجهة الأمامية
    res.status(httpStatus).json({
      error: customMessage,
      code: customCode,
      isQuotaExceeded: isQuotaExceeded // هذا العلم هو المفتاح للواجهة الأمامية
    });
  }
});

// منفذ التشغيل
const PORT = process.env.PORT |

| 3000;
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
});
