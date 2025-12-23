const express = require("express");
const cors = require("cors");
require("dotenv").config();
const OpenAI = require("openai");

const app = express();
const PORT = Number(process.env.PORT || 8787);

const allowOrigins = [
  "https://app.fiqry.com",
  "http://localhost:5173"
];

app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true);
    if (allowOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked for origin: " + origin), false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "1mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get(["/health", "/api/health"], (req, res) => res.json({ ok: true }));

function safeStr(v) { return (v ?? "").toString().trim(); }
function joinTanggal(schedule) {
  const a = safeStr(schedule?.date_text || schedule?.start_date_text);
  const b = safeStr(schedule?.end_date_text);
  if (a && b) return `${a} – ${b}`;
  return a || b || "";
}
function actionInstruction(action) {
  const a = safeStr(action);
  if (a === "followup_h3") return `FOLLOW-UP H+3: follow-up sopan, cek minat, tawarkan proposal, minta jumlah peserta, ajak call 10 menit.`;
  if (a === "reminder_h7") return `REMINDER H-7: ingatkan jadwal, highlight benefit, kuota, minta konfirmasi peserta, ajak percepat administrasi.`;
  if (a === "objection_reply") return `JAWAB KEBERATAN: empatik, solutif, beri opsi (public/in-house), CTA jelas.`;
  return `PENAWARAN AWAL: perkenalan singkat, value, info inti training, CTA jumlah peserta + opsi public/in-house + call 10 menit.`;
}

function buildPrompt(body) {
  const schedule = body?.schedule || {};
  if (!safeStr(schedule.course_title)) return { error: "Missing schedule.course_title" };

  const tanggal = joinTanggal(schedule);
  const lead = body?.lead || {};

  const system = `
Anda adalah asisten marketing B2B training di Indonesia.
Buat copy promosi profesional siap pakai untuk WhatsApp & Email.

Aturan:
- Bahasa Indonesia sopan, to-the-point.
- Jangan mengarang tanggal/fee/link; jika kosong, hilangkan.
- WA short ~500 karakter, WA long ~1200 karakter.
- Email subject max 70 karakter.
- Sertakan link silabus/brosur jika ada.
- CTA wajib: minta jumlah peserta + opsi public/in-house + ajak call 10 menit.

Output HARUS JSON:
{"wa":{"short":"","long":""},"email":{"subject":"","body":""}}
`.trim();

  const user = `
Instruksi: ${actionInstruction(body?.action)}

DATA TRAINING:
- Judul: ${safeStr(schedule.course_title)}
- Kota: ${safeStr(schedule.venue_city)}
- Tanggal: ${tanggal}
- Fee: ${safeStr(schedule.fee_text)}
- Kategori: ${safeStr(schedule.category_label)}
- Silabus: ${safeStr(schedule.syllabus_url)}
- Brosur: ${safeStr(schedule.brochure_url)}

KONTEKS LEAD (jika ada):
- Nama: ${safeStr(lead.name || lead.lead_name)}
- Perusahaan: ${safeStr(lead.company)}
- Jabatan: ${safeStr(lead.role)}
- Need/Pain: ${safeStr(lead.need || lead.pain)}
- Status: ${safeStr(lead.status_pipeline || lead.status)}
- Catatan: ${safeStr(lead.notes)}

Permintaan tambahan: ${safeStr(body?.custom_request)}
`.trim();

  return { system, user };
}

app.post("/api/ai/promo", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const built = buildPrompt(req.body || {});
    if (built.error) return res.status(400).json({ error: built.error });

    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.55,
      messages: [
        { role: "system", content: built.system },
        { role: "user", content: built.user }
      ],
      response_format: { type: "json_object" }
    });

    const text = resp.choices?.[0]?.message?.content || "{}";
    let data;
    try { data = JSON.parse(text); } catch {
      return res.status(502).json({ error: "Model returned non-JSON", raw: text });
    }

    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get("/", (req, res) => res.send("OK - AI Gateway"));

app.listen(PORT, () => console.log("AI Gateway running on port", PORT));
