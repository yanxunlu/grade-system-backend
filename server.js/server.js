require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// 中間件設定
app.use(cors());
app.use(bodyParser.json());

// 提供 images 資料夾作為靜態檔案服務（圖片位於根目錄的 images 資料夾）
app.use("/images", express.static(path.join(__dirname, "..", "images")));

// 提供根目錄所有靜態檔案（包括 index.html、student.html 等）
app.use(express.static(path.join(__dirname, "..")));

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

// 修改首頁路由：回傳根目錄的 index.html 前端頁面
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
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
    const groupedGrades = await Grade.aggregate([
      {
        $group: {
          _id: "$studentName",
          details: { $push: { subject: "$subject", score: "$score" } }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    res.status(200).json({ data: groupedGrades });
  } catch (err) {
    res.status(500).json({ message: "統整成績失敗", error: err });
  }
});

// ==============【 組距統計 】=============
app.get("/grades/scoreDistribution", async (req, res) => {
  try {
    const distribution = await Grade.aggregate([
      {
        $project: {
          subject: 1,
          score: { $toDouble: "$score" }
        }
      },
      {
        $bucket: {
          groupBy: "$score",
          boundaries: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101],
          default: "Other",
          output: {
            count: { $sum: 1 }
          }
        }
      },
      {
        $project: {
          range: {
            $cond: [
              { $eq: ["$_id", 90] },
              "90-100",
              {
                $cond: [
                  { $eq: ["$_id", "Other"] },
                  "Other",
                  {
                    $concat: [
                      { $toString: "$_id" },
                      "-",
                      { $toString: { $subtract: [{ $add: ["$_id", 10] }, 1] } }
                    ]
                  }
                ]
              }
            ]
          },
          count: 1,
          _id: 0
        }
      }
    ]);
    res.status(200).json({ data: distribution });
  } catch (err) {
    res.status(500).json({ message: "組距統計失敗", error: err });
  }
});

// ==============【 每人平均排名 】=============
app.get("/grades/averageRanking", async (req, res) => {
  try {
    const ranking = await Grade.aggregate([
      {
        $group: {
          _id: "$studentName",
          avgScore: { $avg: "$score" }
        }
      },
      {
        $setWindowFields: {
          sortBy: { avgScore: -1 },
          output: {
            rank: { $rank: {} }
          }
        }
      },
      {
        $project: {
          studentName: "$_id",
          avgScore: 1,
          rank: 1,
          _id: 0
        }
      }
    ]);
    res.status(200).json({ data: ranking });
  } catch (err) {
    res.status(500).json({ message: "計算平均排名失敗", error: err });
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

// 啟動伺服器
app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 伺服器運行於 http://localhost:${port}`);
});

