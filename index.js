import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";

// تحميل متغيرات البيئة (فقط إذا كنت تستخدم .env محليًا)
dotenv.config();

const app = express();

// تفعيل CORS للجميع (مهم للتجريب من HTML خارجي)
app.use(cors({ origin: "*" }));

app.use(bodyParser.json());

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";

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
              { text: prompt } // 👈 بدون أي تعديل أو إضافات
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
});
