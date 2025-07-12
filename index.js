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

    const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "ما في رد.";
    res.json({ response: result });

  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.error?.message?.toLowerCase() || "";

    console.error("خطأ في الاتصال بـ Gemini:", message || err.message);

    // ✅ تحقق شامل من انتهاء التوكنات أو الحصة
    const quotaMessages = [
      "you exceeded your current quota, please check your plan and billing details",
      "resource has been exhausted",
      "you exceeded your current quota",
      "quota exceeded",
      "quota exceeded: tokenspermonth",
      "the request was blocked due to quota limits",
      "billing account not configured",
      "project has exceeded its quota limits"
    ];

    const isQuotaError = status === 429 || quotaMessages.some(m => message.includes(m));
    if (isQuotaError) {
      
      return res.status(429).json({ error: "quota_exceeded" });
    }

    res.status(500).json({ error: "فشل الاتصال مع Gemini API" });
  }
});

// منفذ التشغيل
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
});
