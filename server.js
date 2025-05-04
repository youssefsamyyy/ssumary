const express = require('express');
const { VertexAI } = require('@google-cloud/vertexai');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// Validate environment variables
const requiredEnvVars = ['GCLOUD_PROJECT_ID', 'GCLOUD_LOCATION', 'GOOGLE_APPLICATION_CREDENTIALS'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Error: Missing required environment variable ${envVar}`);
    process.exit(1);
  }
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later" }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(limiter);
app.use(express.static(path.join(__dirname, 'public')));

// File upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and DOCX files are allowed'), false);
    }
  }
});

// Initialize Vertex AI
const vertexAI = new VertexAI({
  project: process.env.GCLOUD_PROJECT_ID,
  location: process.env.GCLOUD_LOCATION
});

const model = vertexAI.getGenerativeModel({
  model: "gemini-1.5-pro-preview-0409",
  generationConfig: {
    temperature: 0.5,
    topP: 0.95,
    maxOutputTokens: 65535,
  },
  safetySettings: [
    {category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
    {category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
    {category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
    {category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
  ],
});

// Summarize File Endpoint
app.post('/summarizeFile', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: "No file uploaded",
        message: "Please upload a PDF or DOCX file"
      });
    }

    let text;
    
    if (req.file.mimetype === 'application/pdf') {
      const data = await pdfParse(req.file.buffer);
      text = data.text;
    } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value;
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ 
        error: "Empty file",
        message: "The file contains no readable text"
      });
    }

    const summaryPrompt = `Generate an exhaustive, detailed academic summary in Arabic of the following content:
    
${text}

The summary should be extremely detailed (25-30% of original length), covering:
1. Central thesis/argument
2. Chapter-by-chapter analysis
3. Key concepts and definitions
4. Methodology
5. Evidence used
6. Conclusions
7. Scholarly contribution`;

    const summaryRequest = {
      contents: [{
        role: "user",
        parts: [{ text: summaryPrompt }]
      }]
    };

    const summaryResponse = await model.generateContent(summaryRequest);
    const summary = summaryResponse.response.candidates[0].content.parts[0].text;

    res.json({
      summary: summary,
      status: "success",
      fileSize: `${(req.file.size / (1024 * 1024)).toFixed(2)} MB`
    });

  } catch (error) {
    console.error("File processing error:", error);
    res.status(500).json({ 
      error: "File processing failed",
      message: error.message
    });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});