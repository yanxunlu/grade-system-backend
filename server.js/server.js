require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const port = 3000;

// 中間件設定
app.use(cors());
app.use(bodyParser.json());

// 提供 images 資料夾作為靜態檔案服務
app.use(express.static(path.join(__dirname, "images")));

// ⚠️ 新增：提供 public 資料夾作為靜態檔案服務
app.use(express.static(path.join(__dirname, "public")));

// 連線 MongoDB（請確認帳號、密碼、叢集名稱、資料庫名稱皆正確）
mongoose
  .connect("mongodb+srv://yanxun:a510755555@cluster0.8j0ui.mongodb.net/gradeSystem?retryWrites=true&w=majority&appName=Cluster0")
  .then(() => console.log("✅ 已連線 MongoDB"))
  .catch((err) => console.error("❌ 連線失敗：", err));

// 定義成績 Schema
const gradeSchema = new mongoose.Schema({
  studentName: String,
  subject: String,
  score: Number,
  date: { type: Date, default: Date.now },
});

// 創建 Mongoose Model
const Grade = mongoose.model("Grade", gradeSchema);

// 測試 API：首頁
app.get("/", (req, res) => {
  res.send("成績管理系統 API 運行中 🚀");
});

// ==============【 單筆新增成績 】=============
app.post("/grades", async (req, res) => {
  try {
    let { studentName, subject, score } = req.body;
    if (!studentName || !subject || score === undefined) {
      return res.status(400).json({ message: "請提供完整的成績資訊" });
    }
    studentName = studentName.trim();
    const newGrade = new Grade({ studentName, subject, score });
    await newGrade.save();
    res.status(201).json({ message: "成績已新增", data: newGrade });
  } catch (err) {
    res.status(500).json({ message: "新增成績失敗", error: err });
  }
});

// ==============【 查詢所有成績 】=============
app.get("/grades", async (req, res) => {
  try {
    const grades = await Grade.find();
    res.status(200).json({ data: grades });
  } catch (err) {
    res.status(500).json({ message: "查詢成績失敗", error: err });
  }
});

// ==============【 批次匯入成績 】=============
app.post("/grades/batch", async (req, res) => {
  try {
    const { grades } = req.body;
    // 檢查資料格式是否為陣列
    if (!Array.isArray(grades)) {
      return res.status(400).json({ success: false, message: "資料格式錯誤，需提供陣列" });
    }
    // 檢查每筆資料是否都有 studentName, subject, score
    if (!grades.every(item => item.studentName && item.subject && item.score !== undefined)) {
      return res.status(400).json({
        success: false,
        message: "每筆成績都需包含 { studentName, subject, score }"
      });
    }
    // 批次插入
    await Grade.insertMany(grades);
    res.status(200).json({
      success: true,
      message: "批次匯入成功",
      count: grades.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "批次匯入失敗", error: err });
  }
});

// ==============【 更新單筆成績 】=============
app.put("/grades/:id", async (req, res) => {
  try {
    const updatedGrade = await Grade.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updatedGrade) {
      return res.status(404).json({ message: "找不到該成績" });
    }
    res.status(200).json({ message: "成績已更新", data: updatedGrade });
  } catch (err) {
    res.status(500).json({ message: "更新成績失敗", error: err });
  }
});

// ==============【 刪除單筆成績 】=============
app.delete("/grades/:id", async (req, res) => {
  try {
    const deletedGrade = await Grade.findByIdAndDelete(req.params.id);
    if (!deletedGrade) {
      return res.status(404).json({ message: "找不到該成績" });
    }
    res.status(200).json({ message: "成績已刪除", data: deletedGrade });
  } catch (err) {
    res.status(500).json({ message: "刪除成績失敗", error: err });
  }
});

// ==============【 刪除所有成績 】=============
app.delete("/grades", async (req, res) => {
  try {
    const result = await Grade.deleteMany({});
    res.status(200).json({ message: "所有成績已刪除", data: result });
  } catch (err) {
    res.status(500).json({ message: "刪除所有成績失敗", error: err });
  }
});

// ==============【 統整成績：聚合同名學生 】=============
app.post("/grades/merge", async (req, res) => {
  try {
    const data = await mergeGrades(); // 這是你合併成績的邏輯
    res.status(200).json({ data: data });
  } catch (err) {
    res.status(500).json({ message: "統整成績失敗", error: err });
  }
});
// ==============【 組距統計：依科目分類 】=============
app.get("/grades/scoreDistribution", async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ message: "組距統計失敗", error: err });
  }
});






// ==============【 科目成績統整 】=============
app.get("/grades/subjectDistribution", async (req, res) => {
  try {
    const subjectDistribution = await Grade.aggregate([
      {
        $group: {
          _id: { subject: "$subject", score: "$score" },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: "$_id.subject",
          scoreDistribution: { $push: { score: "$_id.score", count: "$count" } }
        }
      },
      {
        $project: {
          subject: "$_id",
          scoreDistribution: 1,
          _id: 0
        }
      },
      { $sort: { subject: 1 } }
    ]);
    res.status(200).json({ data: subjectDistribution });
  } catch (err) {
    res.status(500).json({ message: "科目成績統整失敗", error: err });
  }
});
// ==============【 每人平均分數及排名 】=============
app.get("/grades/averageRanking", async (req, res) => {
  try {
    const averages = await Grade.aggregate([
      {
        $group: {
          _id: "$studentName",
          avgScore: { $avg: "$score" }
        }
      },
      {
        $sort: { avgScore: -1 }
      }
    ]);

    // 加上排名
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
async function mergeGrades() {
  try {
    const result = await Grade.aggregate([
      {
        $group: {
          _id: "$studentName",
          totalScore: { $sum: "$score" },
          avgScore: { $avg: "$score" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { totalScore: -1 },
      },
    ]);
    return result;  // 返回統整結果
  } catch (err) {
    console.error("統整成績時發生錯誤：", err);
    throw new Error("統整成績失敗");
  }
}

// 啟動伺服器，監聽指定 IP
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
