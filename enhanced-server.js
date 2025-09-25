// enhanced-server.js
require("dotenv").config();
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const https = require('https');
const formidable = require('formidable');
const pdfParse = require('pdf-parse');
const crypto = require('crypto');

// Import database setup
const { initializeDatabase, createUserDirectories } = require('./setup-database');

// Initialize database on startup
initializeDatabase();

// --- Load dataset ---
let dataset = {};
try {
  dataset = JSON.parse(fs.readFileSync("qa.json", "utf-8"));
  console.log("✅ Dataset loaded successfully");
} catch (error) {
  console.error("❌ Failed to load qa.json:", error.message);
}

// --- API setup ---
const GROQ_API_KEY = process.env.GROQ_API_KEY || "YOUR_GROQ_API_KEY";
const MODEL_NAME = "llama-3.1-8b-instant";
console.log(GROQ_API_KEY && GROQ_API_KEY !== "YOUR_GROQ_API_KEY" 
  ? "✅ Groq API key loaded" 
  : "⚠️ API key missing!");

// --- User & Session Management ---
const USERS_DIR = path.join(__dirname, 'users');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
let activeSessions = {};

// Load active sessions
try {
  if (fs.existsSync(SESSIONS_FILE)) {
    activeSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    console.log("✅ Active sessions loaded");
  }
} catch (error) {
  console.warn("⚠️ Failed to load sessions:", error.message);
}

// Save sessions with better error handling
function saveSessions() {
  try {
    // Ensure directory exists
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Create backup before writing
    if (fs.existsSync(SESSIONS_FILE)) {
      fs.copyFileSync(SESSIONS_FILE, SESSIONS_FILE + '.backup');
    }
    
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(activeSessions, null, 2));
    console.log("✅ Sessions saved successfully");
  } catch (error) {
    console.error("❌ Failed to save sessions:", error.message);
    
    // Try to restore from backup
    const backupFile = SESSIONS_FILE + '.backup';
    if (fs.existsSync(backupFile)) {
      try {
        fs.copyFileSync(backupFile, SESSIONS_FILE);
        console.log("✅ Sessions restored from backup");
      } catch (restoreError) {
        console.error("❌ Failed to restore sessions from backup:", restoreError.message);
      }
    }
  }
}

// Auto-save sessions every 5 minutes
setInterval(saveSessions, 5 * 60 * 1000);

// Hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// --- Enhanced User Data Management ---

// Get user file path with better error handling
function getUserFilePath(userId, filename) {
  const userDir = path.join(USERS_DIR, userId);
  if (!fs.existsSync(userDir)) {
    createUserDirectories(userId);
  }
  return path.join(userDir, filename);
}

// Load user data with backup system
function loadUserData(userId, filename) {
  const filePath = getUserFilePath(userId, filename);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
    
    // Try backup file
    const backupPath = filePath + '.backup';
    if (fs.existsSync(backupPath)) {
      console.log(`⚠️ Loading backup for ${filename} for ${userId}`);
      const data = fs.readFileSync(backupPath, 'utf8');
      return JSON.parse(data);
    }
    
  } catch (error) {
    console.warn(`⚠️ Failed to load ${filename} for ${userId}:`, error.message);
    
    // Try backup file if main file is corrupted
    const backupPath = filePath + '.backup';
    if (fs.existsSync(backupPath)) {
      try {
        const data = fs.readFileSync(backupPath, 'utf8');
        console.log(`✅ Restored ${filename} from backup for ${userId}`);
        return JSON.parse(data);
      } catch (backupError) {
        console.error(`❌ Backup file also corrupted for ${filename}:`, backupError.message);
      }
    }
  }
  return null;
}

// Save user data with backup system
function saveUserData(userId, filename, data) {
  const filePath = getUserFilePath(userId, filename);
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Create backup before writing
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.backup');
    }
    
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, jsonData);
    
    console.log(`✅ Saved ${filename} for ${userId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to save ${filename} for ${userId}:`, error.message);
    
    // Try to restore from backup
    const backupPath = filePath + '.backup';
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, filePath);
        console.log(`✅ Restored ${filename} from backup for ${userId}`);
      } catch (restoreError) {
        console.error(`❌ Failed to restore ${filename} from backup:`, restoreError.message);
      }
    }
    return false;
  }
}

// Get user profile
function getUserProfile(userId) {
  return loadUserData(userId, 'profile.json');
}

// Update user profile
function updateUserProfile(userId, updates) {
  const profile = getUserProfile(userId) || createDefaultProfile(userId);
  Object.assign(profile, updates);
  return saveUserData(userId, 'profile.json', profile);
}

// Create default profile if none exists
function createDefaultProfile(userId) {
  return {
    userId,
    email: '',
    username: '',
    password: '',
    createdAt: new Date().toISOString(),
    lastLogin: null,
    preferences: {
      answerLength: 'medium',
      analogyStyle: 'general',
      bloomsLevel: 'analyze',
      studyStreak: 0,
      focusLevel: 'medium',
      theme: 'dark',
      customSubjects: []
    },
    analytics: {
      questionsAsked: 0,
      conceptsLearned: [],
      weakAreas: [],
      studyTime: 0,
      subjectProgress: {},
      bloomsLevels: {
        remember: 0,
        understand: 0,
        apply: 0,
        analyze: 0,
        evaluate: 0,
        create: 0
      }
    }
  };
}

// User registration with better error handling
function registerUser(email, password, username) {
  const userId = crypto.createHash('md5').update(email).digest('hex');
  
  try {
    // Create user directories first
    createUserDirectories(userId);
    
    // Check if user already exists
    const existingProfile = getUserProfile(userId);
    if (existingProfile && existingProfile.email) {
      return { success: false, error: 'User already exists' };
    }
    
    const userData = createDefaultProfile(userId);
    userData.email = email;
    userData.username = username;
    userData.password = hashPassword(password);
    
    const success = saveUserData(userId, 'profile.json', userData);
    if (success) {
      console.log(`✅ User registered: ${email} (${userId})`);
      return { success: true, userId, username };
    } else {
      return { success: false, error: 'Failed to save user data' };
    }
  } catch (error) {
    console.error(`❌ Registration error for ${email}:`, error);
    return { success: false, error: 'Registration failed' };
  }
}

// User login with session persistence
function loginUser(email, password) {
  const userId = crypto.createHash('md5').update(email).digest('hex');
  let userData = getUserProfile(userId);
  
  // If user data is corrupted or missing, try to recover
  if (!userData) {
    console.log(`⚠️ User data missing for ${email}, checking backups...`);
    return { success: false, error: 'User not found' };
  }
  
  if (!userData.password || userData.password !== hashPassword(password)) {
    return { success: false, error: 'Invalid password' };
  }
  
  // Update last login and streak with better date handling
  try {
    const lastLogin = userData.lastLogin ? new Date(userData.lastLogin) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day
    
    if (lastLogin) {
      const lastLoginDay = new Date(lastLogin);
      lastLoginDay.setHours(0, 0, 0, 0);
      const daysDiff = Math.floor((today - lastLoginDay) / (1000 * 60 * 60 * 24));
      
      if (daysDiff === 1) {
        userData.preferences.studyStreak += 1;
      } else if (daysDiff > 1) {
        userData.preferences.studyStreak = 1;
      }
      // If daysDiff === 0, same day login, maintain streak
    } else {
      userData.preferences.studyStreak = 1;
    }
    
    userData.lastLogin = new Date().toISOString();
    updateUserProfile(userId, userData);
  } catch (error) {
    console.error(`⚠️ Error updating login data for ${userId}:`, error);
  }
  
  const sessionToken = generateSessionToken();
  activeSessions[sessionToken] = {
    userId,
    email: userData.email,
    username: userData.username,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  };
  
  // Save sessions immediately
  saveSessions();
  
  console.log(`✅ User logged in: ${email}`);
  return {
    success: true,
    sessionToken,
    username: userData.username,
    userId,
    preferences: userData.preferences,
    analytics: userData.analytics
  };
}

// Validate session with activity tracking
function validateSession(sessionToken) {
  const session = activeSessions[sessionToken];
  if (session) {
    // Update last activity
    session.lastActivity = new Date().toISOString();
    return session;
  }
  return null;
}

// Clean up expired sessions (24 hours)
function cleanupExpiredSessions() {
  const now = new Date();
  const expiredSessions = [];
  
  for (const [token, session] of Object.entries(activeSessions)) {
    const lastActivity = new Date(session.lastActivity);
    const hoursDiff = (now - lastActivity) / (1000 * 60 * 60);
    
    if (hoursDiff > 24) {
      expiredSessions.push(token);
    }
  }
  
  expiredSessions.forEach(token => delete activeSessions[token]);
  
  if (expiredSessions.length > 0) {
    console.log(`🧹 Cleaned up ${expiredSessions.length} expired sessions`);
    saveSessions();
  }
}

// Clean up sessions every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// --- PDF Management ---

// Process multiple PDFs
async function processMultiplePDFs(userId, files) {
  const results = [];
  
  for (const file of files) {
    try {
      const result = await processPDF(userId, file);
      results.push(result);
    } catch (error) {
      console.error(`Error processing PDF ${file.originalFilename}:`, error);
      results.push({ 
        success: false, 
        error: `Failed to process ${file.originalFilename}`,
        filename: file.originalFilename 
      });
    }
  }
  
  return results;
}

// Enhanced PDF processing with better error handling
async function processPDF(userId, fileData) {
  try {
    const pdfId = crypto.randomUUID();
    const filename = `${pdfId}.pdf`;
    const userPdfDir = path.join(USERS_DIR, userId, 'pdfs');
    
    // Ensure directory exists
    if (!fs.existsSync(userPdfDir)) {
      fs.mkdirSync(userPdfDir, { recursive: true });
    }
    
    const pdfPath = path.join(userPdfDir, filename);
    
    // Save PDF file
    fs.writeFileSync(pdfPath, fileData.buffer);
    
    // Extract text with timeout
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfData = await Promise.race([
      pdfParse(pdfBuffer),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('PDF parsing timeout')), 30000)
      )
    ]);
    
    // Save extracted text
    const textDir = path.join(USERS_DIR, userId, 'extracted-text');
    if (!fs.existsSync(textDir)) {
      fs.mkdirSync(textDir, { recursive: true });
    }
    
    const textPath = path.join(textDir, `${pdfId}.txt`);
    fs.writeFileSync(textPath, pdfData.text);
    
    // Process text into chunks
    const chunks = createTextChunks(pdfData.text);
    
    // Auto-detect subject
    const subject = detectSubject(pdfData.text);
    
    // Create PDF metadata
    const pdfMetadata = {
      id: pdfId,
      originalName: fileData.originalFilename,
      filename: filename,
      uploadedAt: new Date().toISOString(),
      size: fileData.size,
      pages: pdfData.numpages,
      subject: subject,
      keywords: extractKeywords(pdfData.text),
      chunks: chunks,
      textLength: pdfData.text.length
    };
    
    // Load existing PDFs and add new one
    let userPDFs = loadUserData(userId, 'pdfs.json') || {};
    userPDFs[pdfId] = pdfMetadata;
    
    const success = saveUserData(userId, 'pdfs.json', userPDFs);
    
    if (success) {
      return { success: true, pdfId, metadata: pdfMetadata };
    } else {
      throw new Error('Failed to save PDF metadata');
    }
    
  } catch (error) {
    console.error('PDF processing error:', error);
    return { 
      success: false, 
      error: error.message.includes('timeout') ? 'PDF processing timeout' : 'Failed to process PDF'
    };
  }
}

// Create text chunks for better context retrieval
function createTextChunks(text, chunkSize = 1000) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const chunks = [];
  let currentChunk = '';
  let chunkId = 0;
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        id: `chunk-${chunkId++}`,
        text: currentChunk.trim(),
        length: currentChunk.length
      });
      currentChunk = sentence;
    } else {
      currentChunk += sentence + '. ';
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: `chunk-${chunkId}`,
      text: currentChunk.trim(),
      length: currentChunk.length
    });
  }
  
  return chunks;
}

// Enhanced subject detection
function detectSubject(text) {
  const lowerText = text.toLowerCase();
  const subjects = {
    mathematics: ['equation', 'theorem', 'proof', 'calculus', 'algebra', 'geometry', 'derivative', 'integral', 'matrix', 'vector'],
    physics: ['force', 'energy', 'momentum', 'velocity', 'acceleration', 'mass', 'gravity', 'quantum', 'thermodynamics', 'wave'],
    chemistry: ['molecule', 'atom', 'reaction', 'compound', 'element', 'periodic', 'bond', 'ion', 'catalyst', 'solution'],
    biology: ['cell', 'organism', 'gene', 'protein', 'evolution', 'species', 'dna', 'enzyme', 'tissue', 'ecosystem'],
    programming: ['function', 'variable', 'algorithm', 'code', 'programming', 'software', 'data structure', 'class', 'method', 'loop'],
    history: ['war', 'empire', 'civilization', 'century', 'revolution', 'ancient', 'medieval', 'dynasty', 'culture', 'society'],
    literature: ['poem', 'novel', 'author', 'character', 'plot', 'theme', 'narrative', 'metaphor', 'symbolism', 'genre'],
    economics: ['market', 'supply', 'demand', 'price', 'economics', 'trade', 'money', 'inflation', 'gdp', 'business'],
    psychology: ['behavior', 'mind', 'cognitive', 'psychology', 'mental', 'brain', 'emotion', 'learning', 'memory', 'personality']
  };
  
  let maxScore = 0;
  let detectedSubject = 'general';
  
  for (const [subject, keywords] of Object.entries(subjects)) {
    const score = keywords.reduce((acc, keyword) => {
      const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
      return acc + matches;
    }, 0);
    
    if (score > maxScore) {
      maxScore = score;
      detectedSubject = subject;
    }
  }
  
  return detectedSubject;
}

// Extract keywords from text
function extractKeywords(text, limit = 15) {
  const words = text.toLowerCase().match(/\b\w{4,}\b/g) || [];
  const frequency = {};
  
  // Filter out common words
  const stopWords = new Set(['this', 'that', 'with', 'have', 'will', 'from', 'they', 'know', 'want', 'been', 'good', 'much', 'some', 'time', 'very', 'when', 'come', 'here', 'just', 'like', 'long', 'make', 'many', 'over', 'such', 'take', 'than', 'them', 'well', 'were']);
  
  words.forEach(word => {
    if (!stopWords.has(word)) {
      frequency[word] = (frequency[word] || 0) + 1;
    }
  });
  
  return Object.entries(frequency)
    .sort(([,a], [,b]) => b - a)
    .slice(0, limit)
    .map(([word]) => word);
}

// Get relevant PDF context for a question
function getPDFContext(userId, question, maxChunks = 3) {
  const userPDFs = loadUserData(userId, 'pdfs.json') || {};
  const questionLower = question.toLowerCase();
  const relevantChunks = [];
  
  Object.values(userPDFs).forEach(pdf => {
    if (pdf.chunks) {
      pdf.chunks.forEach(chunk => {
        // Simple relevance scoring based on keyword matching
        const chunkLower = chunk.text.toLowerCase();
        const commonWords = questionLower.split(/\s+/).filter(word => 
          word.length > 3 && chunkLower.includes(word)
        );
        
        if (commonWords.length > 0) {
          relevantChunks.push({
            text: chunk.text,
            score: commonWords.length,
            pdfName: pdf.originalName,
            pdfId: pdf.id
          });
        }
      });
    }
  });
  
  // Sort by relevance score and return top chunks
  return relevantChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks);
}

// --- Bookmark Management ---

// Add bookmark
function addBookmark(userId, bookmarkData) {
  try {
    const bookmarks = loadUserData(userId, 'bookmarks.json') || [];
    
    const newBookmark = {
      id: crypto.randomUUID(),
      type: bookmarkData.type,
      content: bookmarkData.content,
      metadata: bookmarkData.metadata || {},
      createdAt: new Date().toISOString(),
      tags: bookmarkData.tags || [],
      subject: bookmarkData.subject || 'general'
    };
    
    bookmarks.push(newBookmark);
    const success = saveUserData(userId, 'bookmarks.json', bookmarks);
    
    return success ? { success: true, bookmark: newBookmark } : { success: false, error: 'Failed to save bookmark' };
  } catch (error) {
    console.error('Error adding bookmark:', error);
    return { success: false, error: 'Failed to add bookmark' };
  }
}

// Get bookmarks
function getBookmarks(userId, subject = null) {
  try {
    const bookmarks = loadUserData(userId, 'bookmarks.json') || [];
    
    if (subject) {
      return bookmarks.filter(bookmark => bookmark.subject === subject);
    }
    
    return bookmarks;
  } catch (error) {
    console.error('Error loading bookmarks:', error);
    return [];
  }
}

// Remove bookmark
function removeBookmark(userId, bookmarkId) {
  try {
    let bookmarks = loadUserData(userId, 'bookmarks.json') || [];
    bookmarks = bookmarks.filter(bookmark => bookmark.id !== bookmarkId);
    
    const success = saveUserData(userId, 'bookmarks.json', bookmarks);
    return success ? { success: true } : { success: false, error: 'Failed to remove bookmark' };
  } catch (error) {
    console.error('Error removing bookmark:', error);
    return { success: false, error: 'Failed to remove bookmark' };
  }
}

// --- Custom Subject Management ---

// Add custom subject
function addCustomSubject(userId, subjectData) {
  try {
    const profile = getUserProfile(userId) || createDefaultProfile(userId);
    
    if (!profile.preferences.customSubjects) {
      profile.preferences.customSubjects = [];
    }
    
    const newSubject = {
      id: crypto.randomUUID(),
      name: subjectData.name,
      color: subjectData.color || '#8B5CF6',
      createdAt: new Date().toISOString()
    };
    
    profile.preferences.customSubjects.push(newSubject);
    
    // Initialize subject progress
    if (!profile.analytics.subjectProgress) {
      profile.analytics.subjectProgress = {};
    }
    profile.analytics.subjectProgress[subjectData.name] = {
      questionsAsked: 0,
      averageAccuracy: 0,
      timeSpent: 0,
      bloomsLevels: {
        remember: 0, understand: 0, apply: 0,
        analyze: 0, evaluate: 0, create: 0
      }
    };
    
    const success = updateUserProfile(userId, profile);
    return success ? { success: true, subject: newSubject } : { success: false, error: 'Failed to save subject' };
  } catch (error) {
    console.error('Error adding custom subject:', error);
    return { success: false, error: 'Failed to add subject' };
  }
}

// --- Enhanced Analytics ---

// Update subject-specific analytics
function updateSubjectAnalytics(userId, subject, data) {
  try {
    const profile = getUserProfile(userId) || createDefaultProfile(userId);
    
    if (!profile.analytics.subjectProgress) {
      profile.analytics.subjectProgress = {};
    }
    
    if (!profile.analytics.subjectProgress[subject]) {
      profile.analytics.subjectProgress[subject] = {
        questionsAsked: 0,
        averageAccuracy: 0,
        timeSpent: 0,
        bloomsLevels: {
          remember: 0, understand: 0, apply: 0,
          analyze: 0, evaluate: 0, create: 0
        }
      };
    }
    
    const subjectData = profile.analytics.subjectProgress[subject];
    subjectData.questionsAsked++;
    
    if (data.accuracy) {
      subjectData.averageAccuracy = ((subjectData.averageAccuracy * (subjectData.questionsAsked - 1)) + data.accuracy) / subjectData.questionsAsked;
    }
    
    if (data.bloomsLevel) {
      subjectData.bloomsLevels[data.bloomsLevel]++;
    }
    
    updateUserProfile(userId, profile);
  } catch (error) {
    console.error('Error updating subject analytics:', error);
  }
}

// --- Continue with the rest of the server code as before, but with all the enhancements ---

// Enhanced Groq API query with PDF context
function queryGroq(question, userPreferences = {}, pdfContext = null, mode = 'normal') {
  return new Promise((resolve, reject) => {
    if (!GROQ_API_KEY || GROQ_API_KEY === "YOUR_GROQ_API_KEY") {
      return reject(new Error("Groq API key missing"));
    }

    let maxTokens, temperature;
    let systemPrompt = "You are PhenBOT, an advanced AI study companion.";

    // Adjust based on user preferences
    switch(userPreferences.answerLength) {
      case 'short':
        maxTokens = 200;
        temperature = 0.3;
        systemPrompt += " Keep answers concise and to the point.";
        break;
      case 'long':
        maxTokens = 1000;
        temperature = 0.7;
        systemPrompt += " Provide comprehensive, detailed explanations with examples.";
        break;
      case 'medium':
      default:
        maxTokens = 500;
        temperature = 0.5;
        systemPrompt += " Provide clear, informative answers.";
    }

    // Add analogy-based learning
    if (userPreferences.analogyStyle && userPreferences.analogyStyle !== 'none') {
      systemPrompt += ` Use ${userPreferences.analogyStyle} analogies to explain complex concepts.`;
    }

    // Add Bloom's taxonomy level
    if (userPreferences.bloomsLevel) {
      systemPrompt += ` Focus on ${userPreferences.bloomsLevel} level understanding.`;
    }

    // Different modes
    switch(mode) {
      case 'reverse':
        systemPrompt += " Act as a student asking probing questions to test understanding.";
        break;
      case 'summary':
        systemPrompt += " Ask the user to summarize the concept in their own words after explaining.";
        break;
      case 'quiz':
        systemPrompt += " End with a quick quiz question related to the topic.";
        break;
    }

    let prompt = question;
    
    // Add PDF context if available
    if (pdfContext && pdfContext.length > 0) {
      const contextTexts = pdfContext.map(chunk => 
        `From "${chunk.pdfName}": ${chunk.text.substring(0, 800)}`
      ).join('\n\n');
      
      prompt = `Use this reference material to help answer the question:

${contextTexts}

Question: ${question}

Please provide a comprehensive answer using the reference material above.`;
    }

    const payload = JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: temperature
    });

    const options = {
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const answer = json.choices?.[0]?.message?.content?.trim();
          if (!answer) reject(new Error("No response from Groq"));
          else resolve(answer);
        } catch (err) {
          reject(new Error("Failed to parse Groq response: " + err.message));
        }
      });
    });

    req.on('error', err => reject(err));
    req.write(payload);
    req.end();
  });
}

// Calculate accuracy score
function calculateAccuracyScore(answer, confidence = 50, source = '', hasPDFContext = false) {
  let score = (typeof confidence === 'number') ? confidence : 50;
  if (String(source).toLowerCase().includes('dataset')) score += 30;
  if (String(source).toLowerCase().includes('pdf') || hasPDFContext) score += 25;
  if (answer && typeof answer === 'string' && answer.length > 100) score += 10;
  return Math.min(Math.max(score, 0), 100);
}

// Analyze Bloom's taxonomy level
function analyzeBloomsLevel(question) {
  const lowerQ = String(question).toLowerCase();
  const createKeywords = ["create","design","compose","develop","plan","construct","produce","formulate","invent","synthesize"];
  const evaluateKeywords = ["evaluate","judge","critique","assess","recommend","justify","argue","support","value","appraise"];
  const analyzeKeywords = ["analyze","compare","contrast","differentiate","examine","test","categorize","investigate","organize"];
  const applyKeywords = ["apply","demonstrate","use","execute","implement","solve","show","perform","experiment","illustrate"];
  const understandKeywords = ["explain","describe","summarize","paraphrase","interpret","classify","discuss","identify","report"];
  const rememberKeywords = ["define","list","recall","state","name","label","repeat","who","what","when","where"];
  
  if (createKeywords.some(kw => lowerQ.includes(kw))) return "create";
  if (evaluateKeywords.some(kw => lowerQ.includes(kw))) return "evaluate";
  if (analyzeKeywords.some(kw => lowerQ.includes(kw))) return "analyze";
  if (applyKeywords.some(kw => lowerQ.includes(kw))) return "apply";
  if (understandKeywords.some(kw => lowerQ.includes(kw))) return "understand";
  if (rememberKeywords.some(kw => lowerQ.includes(kw))) return "remember";
  return "understand";
}

// Save chat history
function saveChatHistory(userId, question, answer, metadata) {
  const chatHistory = loadUserData(userId, 'chat-history.json') || [];
  
  const chatEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    question,
    answer,
    metadata
  };
  
  chatHistory.push(chatEntry);
  
  // Keep only last 100 conversations to manage storage
  if (chatHistory.length > 100) {
    chatHistory.splice(0, chatHistory.length - 100);
  }
  
  saveUserData(userId, 'chat-history.json', chatHistory);
}

// --- Flashcard Management ---

// Create user-made flashcard
function createUserFlashcard(userId, cardData) {
  const flashcards = loadUserData(userId, 'flashcards.json') || { userMade: [], aiGenerated: [] };
  
  const newCard = {
    id: crypto.randomUUID(),
    question: cardData.question,
    answer: cardData.answer,
    subject: cardData.subject || 'general',
    difficulty: cardData.difficulty || 5,
    createdAt: new Date().toISOString(),
    lastReviewed: null,
    reviewCount: 0,
    correctCount: 0,
    tags: cardData.tags || []
  };
  
  if (!flashcards.userMade) flashcards.userMade = [];
  flashcards.userMade.push(newCard);
  
  const success = saveUserData(userId, 'flashcards.json', flashcards);
  return success ? { success: true, card: newCard } : { success: false, error: 'Failed to save flashcard' };
}

// Generate AI flashcards from PDF content
async function generateAIFlashcards(userId, pdfId, count = 5) {
  const userPDFs = loadUserData(userId, 'pdfs.json') || {};
  const pdf = userPDFs[pdfId];
  
  if (!pdf) {
    return { success: false, error: 'PDF not found' };
  }
  
  const flashcards = loadUserData(userId, 'flashcards.json') || { userMade: [], aiGenerated: [] };
  if (!flashcards.aiGenerated) flashcards.aiGenerated = [];
  
  const generatedCards = [];
  
  try {
    // Use PDF chunks to generate flashcards
    const chunksToUse = pdf.chunks ? pdf.chunks.slice(0, count) : [];
    
    for (let i = 0; i < Math.min(count, chunksToUse.length); i++) {
      const chunk = chunksToUse[i];
      const prompt = `Based on this text, create a flashcard question and answer:

Text: ${chunk.text.substring(0, 500)}

Create a clear, educational question and concise answer. Format as:
Q: [question]
A: [answer]`;

      const response = await queryGroq(prompt, { answerLength: 'short' });
      
      if (response) {
        const lines = response.split('\n');
        const questionLine = lines.find(line => line.startsWith('Q:'));
        const answerLine = lines.find(line => line.startsWith('A:'));
        
        if (questionLine && answerLine) {
          const card = {
            id: crypto.randomUUID(),
            question: questionLine.substring(2).trim(),
            answer: answerLine.substring(2).trim(),
            subject: pdf.subject,
            difficulty: 5,
            createdAt: new Date().toISOString(),
            sourceDocument: pdfId,
            lastReviewed: null,
            reviewCount: 0,
            correctCount: 0,
            tags: ['ai-generated', pdf.subject]
          };
          
          flashcards.aiGenerated.push(card);
          generatedCards.push(card);
        }
      }
    }
    
    const success = saveUserData(userId, 'flashcards.json', flashcards);
    if (success) {
      return { success: true, cards: generatedCards };
    } else {
      return { success: false, error: 'Failed to save generated flashcards' };
    }
    
  } catch (error) {
    console.error('AI flashcard generation error:', error);
    return { success: false, error: 'Failed to generate flashcards' };
  }
}

// --- Server setup ---
function createServer(port) {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathName = parsedUrl.pathname;
    const method = req.method;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // Serve frontend
    if (method === 'GET' && (pathName === '/' || pathName === '/index.html')) {
      const indexPath = path.join(__dirname, 'frontend_new.html');
      fs.readFile(indexPath, 'utf8', (err, data) => {
        if (err) { res.writeHead(500); res.end("Failed to load frontend"); return; }
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(data);
      });
      return;
    }

    // --- Authentication endpoints ---
    if (method === 'POST' && pathName === '/register') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { email, password, username } = JSON.parse(body);
          if (!email || !password || !username) {
            res.writeHead(400, {'Content-Type': 'application/json'});
            return res.end(JSON.stringify({ success: false, error: 'Missing required fields' }));
          }
          const result = registerUser(email, password, username);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(result.success ? 200 : 400);
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    if (method === 'POST' && pathName === '/login') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { email, password } = JSON.parse(body);
          if (!email || !password) {
            res.writeHead(400, {'Content-Type': 'application/json'});
            return res.end(JSON.stringify({ success: false, error: 'Email and password required' }));
          }
          const result = loginUser(email, password);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(result.success ? 200 : 400);
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    // --- Protected endpoints ---
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader ? authHeader.replace('Bearer ', '') : null;
    const session = sessionToken ? validateSession(sessionToken) : null;
    
    // Logout endpoint (doesn't require auth validation)
    if (method === 'POST' && pathName === '/logout') {
      if (sessionToken && activeSessions[sessionToken]) {
        delete activeSessions[sessionToken];
        saveSessions();
      }
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ success: true, message: 'Logged out successfully' }));
      return;
    }

    if (!session && !pathName.startsWith('/public')) {
      res.writeHead(401, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    const userId = session?.userId;
    const userData = userId ? getUserProfile(userId) : null;

    // --- Enhanced question handling with PDF context ---
    if (method === 'POST' && pathName === '/ask') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { question, mode = 'normal', subject, difficulty = 5 } = JSON.parse(body);
          if (!question || typeof question !== 'string') {
            res.writeHead(400, {'Content-Type': 'application/json'});
            return res.end(JSON.stringify({ error: "Invalid question" }));
          }
          const trimmedQuestion = question.trim();
          res.setHeader('Content-Type', 'application/json');

          // Get relevant PDF context
          const pdfContext = getPDFContext(userId, trimmedQuestion);
          const hasPDFContext = pdfContext.length > 0;

          // Analyze Bloom's level
          const bloomsLevel = analyzeBloomsLevel(trimmedQuestion);

          // First check dataset
          const datasetAnswer = dataset[subject]?.[trimmedQuestion] || null;
          let confidence = datasetAnswer ? 90 : 0;
          let answer, source;

          if (datasetAnswer && confidence > 70 && !hasPDFContext) {
            answer = datasetAnswer;
            source = "Local Dataset";
          } else {
            try {
              answer = await queryGroq(
                trimmedQuestion, 
                { ...(userData?.preferences || {}), difficulty }, 
                hasPDFContext ? pdfContext : null, 
                mode
              );
              source = hasPDFContext ? "AI + PDF Reference" : "AI Assistant";
              confidence = calculateAccuracyScore(answer, 75, source, hasPDFContext);
            } catch (err) {
              console.error("Groq API error:", err.message);
              if (datasetAnswer) {
                answer = datasetAnswer;
                source = "Local Dataset (AI unavailable)";
                confidence = 60;
              } else {
                res.end(JSON.stringify({
                  error: "Service temporarily unavailable. Please try again.",
                  confidence: 0,
                  source: "Error"
                }));
                return;
              }
            }
          }

          // Update user analytics
          if (userData) {
            userData.analytics.questionsAsked += 1;
            if (subject && !userData.analytics.conceptsLearned.includes(subject)) {
              userData.analytics.conceptsLearned.push(subject);
            }
            if (bloomsLevel) {
              userData.analytics.bloomsLevels[bloomsLevel] = 
                (userData.analytics.bloomsLevels[bloomsLevel] || 0) + 1;
            }
            
            // Update subject-specific analytics
            if (subject) {
              updateSubjectAnalytics(userId, subject, {
                accuracy: confidence,
                bloomsLevel: bloomsLevel
              });
            }
            
            updateUserProfile(userId, userData);
          }

          // Save chat history
          const metadata = {
            mode,
            subject: subject || 'general',
            source,
            accuracy: confidence,
            bloomsLevel,
            difficulty,
            pdfSources: pdfContext.map(ctx => ctx.pdfId)
          };
          
          if (userId) {
            saveChatHistory(userId, trimmedQuestion, answer, metadata);
          }

          res.end(JSON.stringify({
            answer,
            confidence,
            source,
            bloomsLevel,
            accuracyScore: calculateAccuracyScore(answer, confidence, source, hasPDFContext),
            question: trimmedQuestion,
            mode,
            subject: subject || 'general',
            pdfSources: pdfContext.map(ctx => ({ name: ctx.pdfName, id: ctx.pdfId }))
          }));
        } catch (parseErr) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ error: "Invalid request format", confidence: 0 }));
        }
      });
      return;
    }

    // --- Multiple PDF Upload endpoint ---
    if (method === 'POST' && pathName === '/upload-pdfs') {
      const form = new formidable.IncomingForm();
      form.multiples = true;
      
      form.parse(req, async (err, fields, files) => {
        if (err) {
          console.error('Formidable parsing error:', err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Upload failed during parsing' }));
        }

        const uploadUserId = Array.isArray(fields.userId) ? fields.userId[0] : fields.userId;
        const pdfFiles = files.pdfs;

        if (!uploadUserId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'User ID required' }));
        }

        if (!pdfFiles) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'No PDF files uploaded' }));
        }

        try {
          createUserDirectories(uploadUserId);

          // Handle both single and multiple files
          const fileArray = Array.isArray(pdfFiles) ? pdfFiles : [pdfFiles];
          const fileDataArray = [];

          for (const file of fileArray) {
            const filePath = file.filepath || file.path;
            if (filePath && fs.existsSync(filePath)) {
              fileDataArray.push({
                buffer: fs.readFileSync(filePath),
                originalFilename: file.originalFilename || file.name,
                size: file.size
              });
              
              // Cleanup temp file
              fs.unlinkSync(filePath);
            }
          }

          const results = await processMultiplePDFs(uploadUserId, fileDataArray);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, results }));
        } catch (error) {
          console.error('Error processing uploaded PDFs:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'PDF processing failed' }));
        }
      });
      return;
    }

    // --- Single PDF Upload endpoint (for backward compatibility) ---
    if (method === 'POST' && pathName === '/upload.pdf') {
      const form = new formidable.IncomingForm();
      
      form.parse(req, async (err, fields, files) => {
        if (err) {
          console.error('Formidable parsing error:', err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Upload failed during parsing' }));
        }

        const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
        const uploadUserId = Array.isArray(fields.userId) ? fields.userId[0] : fields.userId;

        if (!file || !uploadUserId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'No PDF file or user ID uploaded' }));
        }

        const filePath = file.filepath || file.path;
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'File path missing' }));
        }

        try {
          createUserDirectories(uploadUserId);

          const fileData = {
            buffer: fs.readFileSync(filePath),
            originalFilename: file.originalFilename || file.name,
            size: file.size
          };

          const result = await processPDF(uploadUserId, fileData);
          fs.unlinkSync(filePath); // Cleanup temp file

          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (error) {
          console.error('Error processing uploaded PDF:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'PDF processing failed' }));
        }
      });
      return;
    }

    // --- Get user PDFs ---
    if (method === 'GET' && pathName === '/user-pdfs') {
      const userPDFs = loadUserData(userId, 'pdfs.json') || {};
      const pdfList = Object.values(userPDFs).map(pdf => ({
        id: pdf.id,
        originalName: pdf.originalName,
        uploadedAt: pdf.uploadedAt,
        subject: pdf.subject,
        pages: pdf.pages,
        keywords: pdf.keywords,
        size: pdf.size
      }));
      
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, pdfs: pdfList }));
      return;
    }

    // --- Flashcard endpoints ---
    if (method === 'POST' && pathName === '/create-flashcard') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const cardData = JSON.parse(body);
          const result = createUserFlashcard(userId, cardData);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(result.success ? 200 : 400);
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    if (method === 'POST' && pathName === '/generate-ai-flashcards') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { pdfId, count = 5 } = JSON.parse(body);
          const result = await generateAIFlashcards(userId, pdfId, count);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(result.success ? 200 : 400);
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    if (method === 'GET' && pathName === '/flashcards') {
      const flashcards = loadUserData(userId, 'flashcards.json') || { userMade: [], aiGenerated: [] };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, flashcards }));
      return;
    }

    // --- Bookmark endpoints ---
    if (method === 'POST' && pathName === '/bookmarks') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const bookmarkData = JSON.parse(body);
          const result = addBookmark(userId, bookmarkData);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(result.success ? 200 : 400);
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    if (method === 'GET' && pathName === '/bookmarks') {
      const subject = parsedUrl.query.subject;
      const bookmarks = getBookmarks(userId, subject);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, bookmarks }));
      return;
    }

    if (method === 'DELETE' && pathName.startsWith('/bookmarks/')) {
      const bookmarkId = pathName.split('/')[2];
      const result = removeBookmark(userId, bookmarkId);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(result.success ? 200 : 400);
      res.end(JSON.stringify(result));
      return;
    }

    // --- Custom subject endpoints ---
    if (method === 'POST' && pathName === '/custom-subjects') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const subjectData = JSON.parse(body);
          const result = addCustomSubject(userId, subjectData);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(result.success ? 200 : 400);
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    // --- User preferences ---
    if (method === 'POST' && pathName === '/preferences') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const preferences = JSON.parse(body);
          if (userData) {
            userData.preferences = { ...userData.preferences, ...preferences };
            const success = updateUserProfile(userId, userData);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(success ? 200 : 500);
            res.end(JSON.stringify({ success }));
          } else {
            res.writeHead(404, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ error: 'User not found' }));
          }
        } catch (error) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    // --- Get user analytics ---
    if (method === 'GET' && pathName === '/analytics') {
      res.setHeader('Content-Type', 'application/json');
      if (userData) {
        res.end(JSON.stringify({ success: true, analytics: userData.analytics }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'User not found' }));
      }
      return;
    }

    // --- Get chat history ---
    if (method === 'GET' && pathName === '/chat-history') {
      const chatHistory = loadUserData(userId, 'chat-history.json') || [];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, history: chatHistory.slice(-20) }));
      return;
    }

    // 404 handler
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end("Not found");
  });

  server.on("error", err => {
    if (err.code === "EADDRINUSE") {
      console.warn(`⚠️ Port ${port} in use, trying ${port + 1}...`);
      createServer(port + 1);
    } else {
      console.error("Server error:", err);
    }
  });

  server.listen(port, () => {
    console.log(`🚀 Enhanced PhenBOT running on http://localhost:${port}`);
    console.log(`👥 Users directory: ${USERS_DIR}`);
    console.log(`📁 Database initialized with user-specific storage`);
    console.log(`💾 Auto-save enabled for data persistence`);
  });
}

// Enhanced cleanup on exit
process.on('SIGINT', () => {
  console.log('\n💾 Saving all data before exit...');
  saveSessions();
  console.log('✅ Data saved. Goodbye!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n💾 Saving all data before termination...');
  saveSessions();
  console.log('✅ Data saved. Shutting down gracefully.');
  process.exit(0);
});

// Start server
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
createServer(PORT);
