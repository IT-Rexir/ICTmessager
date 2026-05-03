// firebase.js - Firebase Configuration & Initialization

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAtZcgtvvAhTYDVqZ4HgfNHmPoIV78Z17k",
  authDomain: "messagerdiy.firebaseapp.com",
  databaseURL: "https://messagerdiy-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "messagerdiy",
  storageBucket: "messagerdiy.firebasestorage.app",
  messagingSenderId: "700057467076",
  appId: "1:700057467076:web:8739c63d06962ccfe03191",
  measurementId: "G-0H9H8028LT"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
