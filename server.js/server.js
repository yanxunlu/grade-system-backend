require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "images")));
app.use(express.static(path.join(__dirname, "public")));

// =================【 資料庫連線 】=================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ 已連線 MongoDB (成績庫)"))
  .catch((err) => console.error("❌ MongoDB 連線失敗：", err));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// =================【 MongoDB 模型 Schema 】=================
const gradeSchema = new mongoose.Schema({
  studentName: String,
  subject: String,
  score: Number,
  date: { type: Date, default: Date.now },
});
const Grade = mongoose.model("Grade", gradeSchema);

// =================【 LINE 推播核心函數 (精美字卡版) 】=================
const sendLinePush = async (studentName, message) => {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.log("⚠️ 錯誤：找不到 Token，請檢查 .env 檔案");
    return;
  }

  try {
    const { data, error } = await supabase
      .from('students') 
      .select('line_user_id')
      .eq('name', studentName) 
      .single();

    if (error || !data || !data.line_user_id) {
      console.log(`⚠️ Supabase 找不到【${studentName}】的 UID。`);
      return;
    }

    const targetUid = data.line_user_id;

    if (!targetUid.startsWith('U') || targetUid.length !== 33) {
      console.log(`❌ 錯誤：這不是有效的 LINE UID！抓到的是：[${targetUid}]`);
      return;
    }

    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: targetUid,
        messages: [
          {
            type: "flex",
            altText: "🔔 您有一則新成績通知",
            contents: {
              type: "bubble",
              size: "mega",
              body: {
                type: "box",
                layout: "vertical",
                contents: [
                  { type: "text", text: "🔔 最新成績通知", weight: "bold", color: "#1DB446", size: "sm" },
                  { type: "text", text: studentName, weight: "bold", size: "xl", margin: "md" },
                  { type: "text", text: message, size: "md", margin: "md", wrap: true }
                ]
              },
              footer: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "button",
                    style: "primary",
                    color: "#1DB446",
                    action: {
                      type: "uri",
                      label: "詳細內容", // 按鈕文字已更新
                      uri: "https://cyshzoo.netlify.app/student.html"
                    }
                  }
                ]
              }
            }
          }
        ]
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        }
      }
    );
    console.log(`✅ 已成功推播字卡給【${studentName}】的家長！`);
  } catch (err) {
    console.error("❌ LINE 推播失敗：", err.response ? JSON.stringify(err.response.data) : err.message);
  }
};

// =================【 API 路由 】=================
app.get("/", (req, res) => {
  res.send("成績管理系統 API 運行中 🚀");
});

app.post("/grades", async (req, res) => {
  try {
    let { studentName, subject, score } = req.body;
    if (!studentName || !subject || score === undefined) {
      return res.status(400).json({ message: "請提供完整的成績資訊" });
    }
    studentName = studentName.trim();
    const newGrade = new Grade({ studentName, subject, score });
    await newGrade.save();

    // 觸發推播 (字卡文字)
    const msg = `${subject} 成績已上傳，分數為：${score}`;
    await sendLinePush(studentName, msg);

    res.status(201).json({ message: "成績已新增", data: newGrade });
  } catch (err) {
    res.status(500).json({ message: "新增成績失敗", error: err });
  }
});

app.post("/grades/batch", async (req, res) => {
  try {
    const { grades } = req.body;
    if (!Array.isArray(grades)) {
      return res.status(400).json({ success: false, message: "資料格式錯誤，需提供陣列" });
    }
    
    await Grade.insertMany(grades);

    const studentUpdates = {};
    grades.forEach(g => {
      if (!studentUpdates[g.studentName]) studentUpdates[g.studentName] = [];
      studentUpdates[g.studentName].push(`${g.subject}: ${g.score}分`);
    });

    for (const studentName of Object.keys(studentUpdates)) {
      // 觸發批次推播 (字卡文字)
      const msg = `以下是最新成績更新：\n${studentUpdates[studentName].join('\n')}`;
      await sendLinePush(studentName, msg);
    }

    res.status(200).json({ success: true, message: "批次匯入成功", count: grades.length });
  } catch (err) {
    res.status(500).json({ success: false, message: "批次匯入失敗", error: err });
  }
});

app.get("/grades", async (req, res) => {
  try {
    const grades = await Grade.find();
    res.status(200).json({ data: grades });
  } catch (err) { res.status(500).json({ message: "查詢成績失敗", error: err }); }
});

app.put("/grades/:id", async (req, res) => {
  try {
    const updatedGrade = await Grade.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updatedGrade) return res.status(404).json({ message: "找不到該成績" });
    res.status(200).json({ message: "成績已更新", data: updatedGrade });
  } catch (err) { res.status(500).json({ message: "更新成績失敗", error: err }); }
});

app.delete("/grades/:id", async (req, res) => {
  try {
    const deletedGrade = await Grade.findByIdAndDelete(req.params.id);
    if (!deletedGrade) return res.status(404).json({ message: "找不到該成績" });
    res.status(200).json({ message: "成績已刪除", data: deletedGrade });
  } catch (err) { res.status(500).json({ message: "刪除成績失敗", error: err }); }
});

app.delete("/grades", async (req, res) => {
  try {
    const result = await Grade.deleteMany({});
    res.status(200).json({ message: "所有成績已刪除", data: result });
  } catch (err) { res.status(500).json({ message: "刪除所有成績失敗", error: err }); }
});

app.post("/grades/merge", async (req, res) => {
  try {
    const result = await Grade.aggregate([
      { $group: { _id: "$studentName", grades: { $push: { subject: "$subject", score: "$score" } } } },
      { $sort: { _id: 1 } }
    ]);
    res.status(200).json({ data: result });
  } catch (err) { res.status(500).json({ message: "統整成績失敗", error: err }); }
});

app.get("/grades/scoreDistribution", async (req, res) => {
  try {
    const buckets = [
      { min: 0, max: 9, label: "0-9" }, { min: 10, max: 19, label: "10~19" },
      { min: 20, max: 29, label: "20~29" }, { min: 30, max: 39, label: "30~39" },
      { min: 40, max: 49, label: "40~49" }, { min: 50, max: 59, label: "50~59" },
      { min: 60, max: 69, label: "60~69" }, { min: 70, max: 79, label: "70~79" },
      { min: 80, max: 89, label: "80~89" }, { min: 90, max: 100, label: "90~100" }
    ];
    const subjects = await Grade.distinct("subject");
    const results = [];
    for (const subject of subjects) {
      const distribution = {};
      buckets.forEach(b => (distribution[b.label] = 0));
      const grades = await Grade.find({ subject });
      grades.forEach(g => {
        const b = buckets.find(b => g.score >= b.min && g.score <= b.max);
        if (b) distribution[b.label]++;
      });
      results.push({ subject, distribution });
    }
    res.status(200).json({ data: results });
  } catch (err) { res.status(500).json({ message: "組距統計失敗", error: err }); }
});

app.get("/grades/averageRanking", async (req, res) => {
  try {
    const averages = await Grade.aggregate([
      { $group: { _id: "$studentName", avgScore: { $avg: "$score" } } },
      { $sort: { avgScore: -1 } }
    ]);
    const result = averages.map((item, index) => ({
      studentName: item._id, avgScore: item.avgScore, rank: index + 1
    }));
    res.status(200).json({ data: result });
  } catch (err) { res.status(500).json({ message: "平均排名失敗", error: err }); }
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
