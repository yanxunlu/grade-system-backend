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

// 連線 MongoDB（請確認帳號、密碼、叢集名稱、資料庫名稱皆正確）
const mongoURI = "mongodb+srv://yanxun:a510755555@cluster0.8j0ui.mongodb.net/gradeSystem?retryWrites=true&w=majority&appName=Cluster0";
mongoose
  .connect(mongoURI)
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

// 新增成績的 API (POST /grades)
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

// 查詢所有成績的 API (GET /grades)
app.get("/grades", async (req, res) => {
  try {
    const grades = await Grade.find();
    res.status(200).json({ data: grades });
  } catch (err) {
    res.status(500).json({ message: "查詢成績失敗", error: err });
  }
});

// 更新成績的 API (PUT /grades/:id)
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

// 刪除單筆成績的 API (DELETE /grades/:id)
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

// 刪除所有成績的 API (DELETE /grades)
app.delete("/grades", async (req, res) => {
  try {
    const result = await Grade.deleteMany({});
    res.status(200).json({ message: "所有成績已刪除", data: result });
  } catch (err) {
    res.status(500).json({ message: "刪除所有成績失敗", error: err });
  }
});

// 聚合同名學生的成績明細 (POST /grades/merge)
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

// 組距統計的 API (GET /grades/scoreDistribution)
// 依據分數區間統計成績筆數，若 _id 為 90 則顯示 "90-100"
// 只回傳各區間的筆數資訊
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
            subjects: { $push: "$subject" }
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
          count: { $ifNull: [{ $size: "$subjects" }, 0] },
          _id: 0
        }
      }
    ]);
    res.status(200).json({ data: distribution });
  } catch (err) {
    res.status(500).json({ message: "組距統計失敗", error: err });
  }
});

// 每人平均加總後的平均排名 (GET /grades/averageRanking)
// 計算每位學生的平均分數與排名（不回傳總分與筆數）
app.get("/grades/averageRanking", async (req, res) => {
  try {
    const ranking = await Grade.aggregate([
      {
        $group: {
          _id: "$studentName",
          avgScore: { $avg: "$score" },
          details: { $push: { subject: "$subject", score: "$score" } }
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
          details: 1,
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

// 新增科目成績統整的 API (GET /grades/subjectDistribution)
// 此端點統整各科目各分數的筆數，回傳每個科目下各分數及筆數的統計結果
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
app.listen(port, () => {
  console.log(`🚀 伺服器運行於 http://localhost:${port}`);
});
