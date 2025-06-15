import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";

// تحميل المتغيرات من البيئة
dotenv.config(); // فقط لو كنت تجرب محلياً

const app = express();

// ✅ تفعيل CORS لجميع المواقع (مهم للمتصفح)
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// ✅ رابط API الخاص بـ Google Gemini 2.0 Flash
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// نقطة النهاية لتلقي الطلبات من HTML أو أي تطبيق
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
                text: `جاوب بسخرية: ${prompt}`
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

// منفذ الاستماع
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
});
