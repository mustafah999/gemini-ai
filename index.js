import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import dotenv from "dotenv";
dotenv.config({ path: "key.env" }); // ← هذا هو السطر اللي أضفناه

const app = express();
app.use(cors());
app.use(bodyParser.json());

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.post("/api/gemini", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "prompt مطلوب" });
  }

  try {
    const result = await google("gemini-1.5-pro", {
      prompt,
      system: "رد ساخر فقط 😂"
    });

    res.json({ response: result.text });
  } catch (err) {
    console.error("خطأ من gemini:", err);
    res.status(500).json({ error: "خطأ في الاتصال مع الذكاء الصناعي" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ الخادم شغال على البورت:", PORT);
});