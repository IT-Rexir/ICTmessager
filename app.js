// app.js - Main Application Logic

import { auth, db } from './firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  ref, set, push, onValue, off, update, remove,
  query, orderByChild, serverTimestamp, onDisconnect, get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── State ─────────────────────────────────────────────────
let currentUser = null;
let selectedUser = null;
let chatId = null;
let typingTimer = null;
let msgListener = null;
let typingListener = null;
let usersListener = null;

// ── DOM Refs ──────────────────────────────────────────────
const authScreen   = document.getElementById('auth-screen');
const appScreen    = document.getElementById('app-screen');
const authError    = document.getElementById('auth-error');
const toast        = document.getElementById('toast');
const usersList    = document.getElementById('users-list');
const msgContainer = document.getElementById('messages-container');
const msgInput     = document.getElementById('msg-input');
const chatHeader   = document.getElementById('chat-header');
const chatPlaceholder = document.getElementById('chat-placeholder');
const typingEl     = document.getElementById('typing-indicator');

// ── Auth Tab Switching ────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.querySelectorAll('.auth-form').forEach(f => {
      f.classList.toggle('hidden', f.id !== `${target}-form`);
    });
    authError.textContent = '';
  });
});

// ── Register ──────────────────────────────────────────────
document.getElementById('register-btn').addEventListener('click', async () => {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  authError.textContent = '';
  if (!name || !email || !pass) return setError('Please fill in all fields.');
  if (pass.length < 6) return setError('Password must be at least 6 characters.');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await set(ref(db, `users/${cred.user.uid}`), {
      uid: cred.user.uid,
      name,
      email,
      createdAt: Date.now()
    });
  } catch (e) {
    setError(friendlyError(e.code));
  }
});

// ── Login ─────────────────────────────────────────────────
document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  authError.textContent = '';
  if (!email || !pass) return setError('Please fill in all fields.');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    setError(friendlyError(e.code));
  }
});

// Enter key on auth inputs
document.querySelectorAll('.auth-form input').forEach(input => {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const form = input.closest('.auth-form');
      form.querySelector('button').click();
    }
  });
});

// ── Logout ────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', async () => {
  await setOnlineStatus(false);
  await signOut(auth);
});

// ── Auth State ────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    document.getElementById('me-name').textContent = user.displayName || 'Me';
    document.getElementById('me-email').textContent = user.email;
    document.getElementById('me-avatar').textContent = getInitial(user.displayName || user.email);
    document.getElementById('me-avatar').className = `avatar online ${avatarClass(user.displayName || user.email)}`;
    await setOnlineStatus(true);
    setupOnDisconnect();
    listenUsers();
  } else {
    currentUser = null;
    selectedUser = null;
    chatId = null;
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    if (usersListener) { off(ref(db, 'users')); usersListener = null; }
    cleanupChat();
  }
});

// ── Online Presence ───────────────────────────────────────
async function setOnlineStatus(online) {
  if (!currentUser) return;
  await update(ref(db, `users/${currentUser.uid}`), {
    online,
    lastSeen: Date.now()
  });
}

function setupOnDisconnect() {
  const r = ref(db, `users/${currentUser.uid}`);
  onDisconnect(r).update({ online: false, lastSeen: Date.now() });
}

// ── Users List ────────────────────────────────────────────
function listenUsers() {
  const usersRef = ref(db, 'users');
  usersListener = onValue(usersRef, snap => {
    const users = [];
    snap.forEach(child => {
      if (child.key !== currentUser.uid) users.push(child.val());
    });
    renderUsers(users);
  });
}

async function renderUsers(users) {
  if (!users.length) {
    usersList.innerHTML = '<div class="empty-users">No other users yet.<br>Share the app!</div>';
    return;
  }
  // For each user, get last message preview
  const promises = users.map(async u => {
    const cId = getChatId(currentUser.uid, u.uid);
    const msgsRef = query(ref(db, `chats/${cId}/messages`), orderByChild('timestamp'));
    const snap = await get(msgsRef);
    let lastMsg = null, lastTime = null, unread = 0;
    snap.forEach(child => {
      const m = child.val();
      lastMsg = m.text;
      lastTime = m.timestamp;
      if (m.receiverId === currentUser.uid && !m.seen) unread++;
    });
    return { ...u, lastMsg, lastTime, unread };
  });
  const enriched = await Promise.all(promises);
  enriched.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

  usersList.innerHTML = '';
  enriched.forEach(u => {
    const div = document.createElement('div');
    div.className = `user-item${selectedUser?.uid === u.uid ? ' active' : ''}`;
    div.dataset.uid = u.uid;
    div.innerHTML = `
      <div class="avatar sm ${avatarClass(u.name)} ${u.online ? 'online' : ''}">
        ${getInitial(u.name)}
      </div>
      <div class="user-item-info">
        <div class="user-item-name">${escHtml(u.name)}</div>
        <div class="user-item-preview">${u.lastMsg ? escHtml(truncate(u.lastMsg, 30)) : 'Start a conversation'}</div>
      </div>
      <div class="user-item-meta">
        ${u.lastTime ? `<span class="user-item-time">${formatTime(u.lastTime)}</span>` : ''}
        ${u.unread > 0 ? `<span class="unread-badge">${u.unread}</span>` : ''}
      </div>`;
    div.addEventListener('click', () => openChat(u));
    usersList.appendChild(div);
  });
}

// ── Open Chat ─────────────────────────────────────────────
function openChat(user) {
  cleanupChat();
  selectedUser = user;
  chatId = getChatId(currentUser.uid, user.uid);

  // Update sidebar active state
  document.querySelectorAll('.user-item').forEach(el => {
    el.classList.toggle('active', el.dataset.uid === user.uid);
  });

  // Show chat header
  chatPlaceholder.style.display = 'none';
  chatHeader.style.display = 'flex';
  document.getElementById('chat-input-area').style.display = 'block';
  msgContainer.style.display = 'flex';

  document.getElementById('chat-name').textContent = user.name;
  document.getElementById('chat-avatar').textContent = getInitial(user.name);
  document.getElementById('chat-avatar').className = `avatar ${avatarClass(user.name)} ${user.online ? 'online' : ''}`;
  document.getElementById('chat-status').textContent = user.online ? 'Active now' : 'Offline';

  // Mobile: slide sidebar out
  if (window.innerWidth <= 700) {
    document.querySelector('.sidebar').classList.add('slide-out');
  }

  msgContainer.innerHTML = '<div class="spinner"></div>';
  listenMessages();
  listenTyping();
  markMessagesRead();
}

// ── Messages Listener ─────────────────────────────────────
function listenMessages() {
  if (!chatId) return;
  const msgsRef = query(ref(db, `chats/${chatId}/messages`), orderByChild('timestamp'));
  msgListener = onValue(msgsRef, snap => {
    const messages = [];
    snap.forEach(child => messages.push({ id: child.key, ...child.val() }));
    renderMessages(messages);
    markMessagesRead();
  });
}

function renderMessages(messages) {
  msgContainer.innerHTML = '';
  if (!messages.length) {
    msgContainer.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:20px;">No messages yet. Say hi! 👋</div>';
    return;
  }

  let lastDate = null;
  let lastSenderId = null;
  let currentGroup = null;

  messages.forEach((msg, idx) => {
    const msgDate = new Date(msg.timestamp);
    const dateStr = msgDate.toDateString();

    // Date separator
    if (dateStr !== lastDate) {
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.textContent = formatDateSep(msg.timestamp);
      msgContainer.appendChild(sep);
      lastDate = dateStr;
      lastSenderId = null;
      currentGroup = null;
    }

    const isSent = msg.senderId === currentUser.uid;
    const groupClass = isSent ? 'sent' : 'recv';

    // New group if sender changed
    if (msg.senderId !== lastSenderId) {
      currentGroup = document.createElement('div');
      currentGroup.className = `msg-group ${groupClass}`;
      msgContainer.appendChild(currentGroup);
      lastSenderId = msg.senderId;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';
    wrapper.dataset.msgId = msg.id;

    const seenHtml = isSent
      ? `<span class="seen-icon">${msg.seen ? '✓✓' : '✓'}</span>`
      : '';

    const deleteBtn = isSent
      ? `<button class="msg-delete-btn" onclick="window.deleteMsg('${msg.id}')">🗑 Delete</button>`
      : '';

    const isLastInGroup = (idx === messages.length - 1) || messages[idx + 1]?.senderId !== msg.senderId;
    const showTime = isLastInGroup;

    wrapper.innerHTML = `
      <div class="msg-bubble" style="position:relative">
        ${deleteBtn}
        ${escHtml(msg.text)}
      </div>`;

    currentGroup.appendChild(wrapper);

    if (showTime) {
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      meta.innerHTML = `${formatMsgTime(msg.timestamp)} ${seenHtml}`;
      currentGroup.appendChild(meta);
    }
  });

  scrollToBottom();
}

// ── Delete Message ────────────────────────────────────────
window.deleteMsg = async (msgId) => {
  if (!chatId || !msgId) return;
  if (!confirm('Delete this message?')) return;
  try {
    await remove(ref(db, `chats/${chatId}/messages/${msgId}`));
    showToast('Message deleted');
  } catch (e) {
    showToast('Could not delete message');
  }
};

// ── Send Message ──────────────────────────────────────────
document.getElementById('send-btn').addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !chatId || !selectedUser) return;

  msgInput.value = '';
  msgInput.style.height = 'auto';
  clearTyping();

  const msgsRef = ref(db, `chats/${chatId}/messages`);
  const newMsgRef = push(msgsRef);
  await set(newMsgRef, {
    senderId: currentUser.uid,
    receiverId: selectedUser.uid,
    text,
    timestamp: Date.now(),
    seen: false
  });
}

// ── Mark as Read ──────────────────────────────────────────
async function markMessagesRead() {
  if (!chatId || !selectedUser) return;
  const msgsRef = query(ref(db, `chats/${chatId}/messages`), orderByChild('timestamp'));
  const snap = await get(msgsRef);
  snap.forEach(child => {
    const m = child.val();
    if (m.receiverId === currentUser.uid && !m.seen) {
      update(ref(db, `chats/${chatId}/messages/${child.key}`), { seen: true });
    }
  });
}

// ── Typing Indicator ──────────────────────────────────────
msgInput.addEventListener('input', () => {
  if (!chatId) return;
  update(ref(db, `chats/${chatId}/typing/${currentUser.uid}`), { typing: true, name: currentUser.displayName });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(clearTyping, 2000);
});

function clearTyping() {
  if (!chatId) return;
  remove(ref(db, `chats/${chatId}/typing/${currentUser.uid}`));
}

function listenTyping() {
  if (!chatId || !selectedUser) return;
  const typRef = ref(db, `chats/${chatId}/typing/${selectedUser.uid}`);
  typingListener = onValue(typRef, snap => {
    const data = snap.val();
    typingEl.style.display = data?.typing ? 'flex' : 'none';
  });
}

// ── Auto-resize textarea ──────────────────────────────────
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
});

// ── Search users ──────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.user-item').forEach(item => {
    const name = item.querySelector('.user-item-name').textContent.toLowerCase();
    item.style.display = name.includes(q) ? '' : 'none';
  });
});

// ── Mobile back button ────────────────────────────────────
document.getElementById('back-btn').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.remove('slide-out');
});

// ── Cleanup ───────────────────────────────────────────────
function cleanupChat() {
  if (msgListener && chatId) {
    off(ref(db, `chats/${chatId}/messages`));
    msgListener = null;
  }
  if (typingListener && chatId && selectedUser) {
    off(ref(db, `chats/${chatId}/typing/${selectedUser.uid}`));
    typingListener = null;
  }
  typingEl.style.display = 'none';
}

// ── Helpers ───────────────────────────────────────────────
function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

function getInitial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

function avatarClass(name) {
  const letter = (name || 'a').charAt(0).toLowerCase();
  return `av-${letter.match(/[a-z]/) ? letter : 'a'}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const diff = (now - d) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMsgTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSep(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function scrollToBottom() {
  msgContainer.scrollTop = msgContainer.scrollHeight;
}

function setError(msg) { authError.textContent = msg; }

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function friendlyError(code) {
  const map = {
    'auth/email-already-in-use': 'Email already registered.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/weak-password': 'Password too weak.',
    'auth/user-not-found': 'No account with that email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/too-many-requests': 'Too many attempts. Try later.'
  };
  return map[code] || 'Something went wrong. Try again.';
}
