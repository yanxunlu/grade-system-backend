require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "images")));
app.use(express.static(path.join(__dirname, "public")));

// ======== MongoDB 連線 ========
mongoose
  .connect("mongodb+srv://yanxun:a510755555@cluster0.8j0ui.mongodb.net/gradeSystem?retryWrites=true&w=majority&appName=Cluster0")
  .then(() => console.log("✅ 已連線 MongoDB"))
  .catch((err) => console.error("❌ 連線失敗：", err));

// ======== 定義 Schema ========
const gradeSchema = new mongoose.Schema({
  studentName: String,
  subject: String,
  score: Number,
  className: { type: String, default: "801" }, // 🔥 分班欄位
  date: { type: Date, default: Date.now },
});

const Grade = mongoose.model("Grade", gradeSchema);

// ======== 首頁測試 ========
app.get("/", (req, res) => {
  res.send("成績管理系統多班版 API 運行中 🚀");
});

// ======== 單筆新增成績 ========
app.post("/grades", async (req, res) => {
  try {
    let { studentName, subject, score, className } = req.body;
    if (!studentName || !subject || score === undefined) {
      return res.status(400).json({ message: "請提供完整的成績資訊" });
    }
    studentName = studentName.trim();
    const newGrade = new Grade({ studentName, subject, score, className: className || "801" });
    await newGrade.save();
    res.status(201).json({ message: "成績已新增", data: newGrade });
  } catch (err) {
    res.status(500).json({ message: "新增成績失敗", error: err });
  }
});

// ======== 查詢所有成績（依班級） ========
app.get("/grades", async (req, res) => {
  try {
    const className = req.query.className || "801";
    const grades = await Grade.find({ className });
    res.status(200).json({ data: grades });
  } catch (err) {
    res.status(500).json({ message: "查詢成績失敗", error: err });
  }
});

// ======== 批次匯入成績（依班級） ========
app.post("/grades/batch", async (req, res) => {
  try {
    const { grades, className } = req.body;
    if (!Array.isArray(grades)) {
      return res.status(400).json({ success: false, message: "資料格式錯誤，需提供陣列" });
    }
    if (!grades.every(item => item.studentName && item.subject && item.score !== undefined)) {
      return res.status(400).json({ success: false, message: "每筆成績都需包含 { studentName, subject, score }" });
    }

    const gradesWithClass = grades.map(g => ({ ...g, className: className || "801" }));
    await Grade.insertMany(gradesWithClass);

    res.status(200).json({
      success: true,
      message: "批次匯入成功",
      count: gradesWithClass.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "批次匯入失敗", error: err });
  }
});

// ======== 刪除所有成績（單一班級） ========
app.delete("/grades", async (req, res) => {
  try {
    const className = req.query.className || "801";
    const result = await Grade.deleteMany({ className });
    res.status(200).json({ message: `已刪除 ${className} 班所有成績`, data: result });
  } catch (err) {
    res.status(500).json({ message: "刪除失敗", error: err });
  }
});

// ======== 統整成績（依班級） ========
app.post("/grades/merge", async (req, res) => {
  try {
    const className = req.query.className || "801";
    const result = await Grade.aggregate([
      { $match: { className } },
      { $group: { _id: "$studentName", grades: { $push: { subject: "$subject", score: "$score" } } } },
      { $sort: { _id: 1 } }
    ]);
    res.status(200).json({ data: result });
  } catch (err) {
    res.status(500).json({ message: "統整成績失敗", error: err });
  }
});

// ======== 組距統計 ========
app.get("/grades/scoreDistribution", async (req, res) => {
  try {
    const className = req.query.className || "801";
    const buckets = [
      { min: 0, max: 9, label: "0-9" },
      { min: 10, max: 19, label: "10~19" },
      { min: 20, max: 29, label: "20~29" },
      { min: 30, max: 39, label: "30~39" },
      { min: 40, max: 49, label: "40~49" },
      { min: 50, max: 59, label: "50~59" },
      { min: 60, max: 69, label: "60~69" },
      { min: 70, max: 79, label: "70~79" },
      { min: 80, max: 89, label: "80~89" },
      { min: 90, max: 100, label: "90~100" }
    ];

    const subjects = await Grade.distinct("subject", { className });
    const results = [];

    for (const subject of subjects) {
      const distribution = {};
      buckets.forEach(b => (distribution[b.label] = 0));
      const grades = await Grade.find({ subject, className });
      grades.forEach(g => {
        const b = buckets.find(b => g.score >= b.min && g.score <= b.max);
        if (b) distribution[b.label]++;
      });
      results.push({ subject, distribution });
    }

    res.status(200).json({ data: results });
  } catch (err) {
    res.status(500).json({ message: "組距統計失敗", error: err });
  }
});

// ======== 平均分數及排名 ========
app.get("/grades/averageRanking", async (req, res) => {
  try {
    const className = req.query.className || "801";
    const averages = await Grade.aggregate([
      { $match: { className } },
      { $group: { _id: "$studentName", avgScore: { $avg: "$score" } } },
      { $sort: { avgScore: -1 } }
    ]);

    const result = averages.map((item, index) => ({
      studentName: item._id,
      avgScore: item.avgScore,
      rank: index + 1
    }));

    res.status(200).json({ data: result });
  } catch (err) {
    res.status(500).json({ message: "平均排名失敗", error: err });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
