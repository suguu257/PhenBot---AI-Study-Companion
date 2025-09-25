// setup-database.js - Enhanced database setup with data persistence and backup systems

const fs = require('fs');
const path = require('path');

// Enhanced database structure for each user
const USER_DATA_STRUCTURE = {
  profile: {
    userId: '',
    email: '',
    username: '',
    password: '', // hashed
    createdAt: '',
    lastLogin: '',
    preferences: {
      answerLength: 'medium',
      analogyStyle: 'general',
      bloomsLevel: 'analyze',
      studyStreak: 0,
      focusLevel: 'medium',
      theme: 'dark',
      customSubjects: [
        // {
        //   id: 'unique-id',
        //   name: 'Custom Subject',
        //   color: '#8B5CF6',
        //   createdAt: 'timestamp'
        // }
      ],
      pomodoroSettings: {
        workDuration: 25,
        shortBreak: 5,
        longBreak: 15,
        sessionsUntilLongBreak: 4
      }
      userProfile: 
{
        displayName: '',
        bio: '',
        profilePicture: '',
        studyGoals: [],
        achievements: [],
        favoriteSubjects: [],
        learningStyle: 'visual', // visual, auditory, kinesthetic, reading
        timezone: 'UTC',
        notifications: {
        studyReminders: true,
        streakAlerts: true,
        achievementNotifications: true
  }
},
    },
    analytics: {
      questionsAsked: 0,
      conceptsLearned: [],
      weakAreas: [],
      studyTime: 0,
      subjectProgress: {
        // 'subjectName': {
        //   questionsAsked: 0,
        //   averageAccuracy: 0,
        //   timeSpent: 0,
        //   bloomsLevels: {
        //     remember: 0, understand: 0, apply: 0,
        //     analyze: 0, evaluate: 0, create: 0
        //   }
        // }
      },
      bloomsLevels: {
        remember: 0,
        understand: 0,
        apply: 0,
        analyze: 0,
        evaluate: 0,
        create: 0
      },
      weeklyStats: [],
      dailyProgress: [
  // {
  //   date: 'YYYY-MM-DD',
  //   questionsAnswered: 0,
  //   studyTimeMinutes: 0,
  //   subjects: ['math', 'science'],
  //   pomodoroSessions: 0,
  //   flashcardsReviewed: 0
  // }
],
      monthlyStats: []
    }
  },
  
  pdfs: {
    // filename: {
    //   id: 'unique-id',
    //   originalName: 'document.pdf',
    //   filename: 'stored-filename.pdf',
    //   uploadedAt: 'timestamp',
    //   size: 'file-size',
    //   pages: 0,
    //   subject: 'auto-detected-subject',
    //   keywords: ['keyword1', 'keyword2'],
    //   textLength: 0,
    //   chunks: [
    //     {
    //       id: 'chunk-1',
    //       text: 'text-chunk',
    //       length: 0,
    //       embedding: [] // for future vector search

