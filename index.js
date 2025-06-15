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
                text: prompt // 🔥 هنا ما ضفنا "جاوب بسخرية"، جاي من HTML مباشرة
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
    console.error("خطأ في الاتصال بـ Gemini:", err.response?.data || err.message);
    res.status(500).json({ error: "فشل الاتصال مع Gemini API" });
  }
});

// منفذ التشغيل
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
});
