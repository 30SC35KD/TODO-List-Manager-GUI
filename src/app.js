const STORAGE_SESSION_KEY = "flowdo_session_v1";
const API = {
  health: "/api/health",
  register: "/api/register",
  login: "/api/login",
  loadTasks: "/api/tasks/load",
  saveTasks: "/api/tasks/save",
};

const MODE_META = {
  create_parent: { text: "创建任务", className: "mode-create-parent" },
  create_subtask: { text: "创建子任务", className: "mode-create-subtask" },
  edit_parent: { text: "修改任务", className: "mode-edit-parent" },
  edit_subtask: { text: "修改子任务", className: "mode-edit-subtask" },
};

const state = {
  currentUser: null,
  tasks: [],
  mode: "create_parent",
  modeTargetId: null,
  expandedTaskIds: new Set(),
  expandedSubtaskGroups: new Set(),
};

const el = {
  authView: document.getElementById("authView"),
  mainView: document.getElementById("mainView"),
  authUsername: document.getElementById("authUsername"),
  authPassword: document.getElementById("authPassword"),
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  accountLabel: document.getElementById("accountLabel"),
  switchBtn: document.getElementById("switchBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  taskList: document.getElementById("taskList"),
  composer: document.getElementById("composer"),
  modeText: document.getElementById("modeText"),
  subjectInput: document.getElementById("subjectInput"),
  ddlInput: document.getElementById("ddlInput"),
  pickDdlBtn: document.getElementById("pickDdlBtn"),
  contentInput: document.getElementById("contentInput"),
  cancelModeBtn: document.getElementById("cancelModeBtn"),
  submitTaskBtn: document.getElementById("submitTaskBtn"),
  ddlModal: document.getElementById("ddlModal"),
  ddlDateInput: document.getElementById("ddlDateInput"),
  ddlTimeInput: document.getElementById("ddlTimeInput"),
  timezoneText: document.getElementById("timezoneText"),
  cancelDdlBtn: document.getElementById("cancelDdlBtn"),
  confirmDdlBtn: document.getElementById("confirmDdlBtn"),
  reminderModal: document.getElementById("reminderModal"),
  reminderBody: document.getElementById("reminderBody"),
  closeReminderBtn: document.getElementById("closeReminderBtn"),
  taskCardTemplate: document.getElementById("taskCardTemplate"),
};

function nowDate() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d;
}

function pad2(num) {
  return String(num).padStart(2, "0");
}

function fmtDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(
    date.getMinutes(),
  )}`;
}

function parseDateTime(text) {
  if (!text || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) {
    return null;
  }
  const d = new Date(text.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function timeInputValue(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseDateAndTime(dateText, timeText) {
  if (!dateText || !timeText) {
    return null;
  }
  const d = new Date(`${dateText}T${timeText}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function humanDelta(targetDate, baseDate = nowDate()) {
  let sec = Math.floor((targetDate.getTime() - baseDate.getTime()) / 1000);
  const overdue = sec < 0;
  sec = Math.abs(sec);
  const day = Math.floor(sec / 86400);
  sec -= day * 86400;
  const hour = Math.floor(sec / 3600);
  sec -= hour * 3600;
  const min = Math.floor(sec / 60);
  const parts = [];
  if (day > 0) parts.push(`${day}天`);
  if (hour > 0) parts.push(`${hour}小时`);
  if (min > 0 || parts.length === 0) parts.push(`${min}分钟`);
  return { overdue, text: parts.join("") };
}

function randomId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function toast(message) {
  let area = document.querySelector(".toast-area");
  if (!area) {
    area = document.createElement("div");
    area.className = "toast-area";
    document.body.appendChild(area);
  }
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  area.appendChild(item);
  window.setTimeout(() => {
    item.remove();
    if (!area.childElementCount) {
      area.remove();
    }
  }, 2400);
}

function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map((t) => ({
    id: t.id,
    parentId: t.parentId ?? null,
    title: t.title ?? "",
    content: t.content ?? "",
    ddl: t.ddl ?? "",
    completed: Boolean(t.completed),
    completedAt: t.completedAt ?? null,
    createdAt: t.createdAt ?? fmtDateTime(nowDate()),
    updatedAt: t.updatedAt ?? fmtDateTime(nowDate()),
    reminder5Sent: Boolean(t.reminder5Sent),
    reminderDueSent: Boolean(t.reminderDueSent),
  }));
}

async function apiJson(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  let payload = {};
  try {
    payload = await resp.json();
  } catch {
    payload = {};
  }
  if (!resp.ok || payload.ok === false) {
    throw new Error(payload.msg || `请求失败: ${resp.status}`);
  }
  return payload;
}

async function loadTasksFromServer(username) {
  const payload = await apiJson(`${API.loadTasks}?username=${encodeURIComponent(username)}`);
  return normalizeTasks(payload.tasks);
}

let saveErrorNotified = false;

async function saveTasksToServer(username, tasks) {
  await apiJson(API.saveTasks, {
    method: "POST",
    body: JSON.stringify({ username, tasks }),
  });
  saveErrorNotified = false;
}

function saveTasks() {
  if (!state.currentUser) return;
  const snapshot = JSON.parse(JSON.stringify(state.tasks));
  void saveTasksToServer(state.currentUser, snapshot).catch((err) => {
    if (!saveErrorNotified) {
      saveErrorNotified = true;
      toast(`保存失败（本地服务不可用）: ${err.message}`);
    }
  });
}

function saveSession(username) {
  if (!username) {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    return;
  }
  localStorage.setItem(STORAGE_SESSION_KEY, username);
}

function setAuthVisible(visible) {
  el.authView.classList.toggle("hidden", !visible);
  el.mainView.classList.toggle("hidden", visible);
}

function setMode(mode, targetId = null) {
  state.mode = mode;
  state.modeTargetId = targetId;
  const meta = MODE_META[mode];
  el.modeText.textContent = meta.text;
  el.composer.classList.remove(
    MODE_META.create_parent.className,
    MODE_META.create_subtask.className,
    MODE_META.edit_parent.className,
    MODE_META.edit_subtask.className,
  );
  el.composer.classList.add(meta.className);
  el.submitTaskBtn.textContent = mode.startsWith("edit_") ? "保存修改" : "提交任务";
}

function resetComposer() {
  setMode("create_parent", null);
  el.subjectInput.value = "";
  el.ddlInput.value = "";
  el.contentInput.value = "";
}

async function register() {
  const username = el.authUsername.value.trim();
  const password = el.authPassword.value.trim();
  if (!username || !password) {
    toast("用户名和密码不能为空");
    return;
  }
  try {
    const payload = await apiJson(API.register, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    toast(payload.msg || "注册成功，请登录");
  } catch (err) {
    toast(err.message);
  }
}

async function login() {
  const username = el.authUsername.value.trim();
  const password = el.authPassword.value.trim();
  if (!username || !password) {
    toast("请输入用户名和密码");
    return;
  }
  try {
    const payload = await apiJson(API.login, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    state.currentUser = username;
    state.tasks = normalizeTasks(payload.tasks);
    state.expandedTaskIds.clear();
    state.expandedSubtaskGroups.clear();
    el.accountLabel.textContent = `当前账户：${username}`;
    setAuthVisible(false);
    saveSession(username);
    resetComposer();
    renderTaskList();
    toast(payload.msg || "登录成功");
  } catch (err) {
    toast(err.message);
  }
}

function logout() {
  state.currentUser = null;
  state.tasks = [];
  saveSession(null);
  setAuthVisible(true);
  el.authPassword.value = "";
}

function findTask(taskId) {
  return state.tasks.find((t) => t.id === taskId) || null;
}

function childrenOf(parentId) {
  const children = state.tasks.filter((t) => t.parentId === parentId);
  children.sort((a, b) => taskSortKey(a) - taskSortKey(b));
  return children;
}

function effectiveDdl(task) {
  if (!task.parentId) {
    const pendingSubs = state.tasks.filter((t) => t.parentId === task.id && !t.completed);
    if (pendingSubs.length) {
      const near = pendingSubs.reduce((min, cur) => {
        const dCur = parseDateTime(cur.ddl);
        const dMin = parseDateTime(min.ddl);
        return dCur < dMin ? cur : min;
      });
      return parseDateTime(near.ddl);
    }
  }
  return parseDateTime(task.ddl);
}

function taskSortKey(task) {
  if (task.completed) {
    const done = parseDateTime(task.completedAt || fmtDateTime(nowDate()));
    return 2_000_000_000_000 + done.getTime();
  }
  const d = effectiveDdl(task);
  const now = nowDate();
  if (d < now) {
    return d.getTime();
  }
  return 1_000_000_000_000 + d.getTime();
}

function syncParentCompletion() {
  const parents = state.tasks.filter((t) => !t.parentId);
  for (const parent of parents) {
    const subs = state.tasks.filter((t) => t.parentId === parent.id);
    if (!subs.length) continue;
    const allDone = subs.every((s) => s.completed);
    if (allDone && !parent.completed) {
      parent.completed = true;
      parent.completedAt = fmtDateTime(nowDate());
      parent.updatedAt = parent.completedAt;
      parent.reminder5Sent = true;
      parent.reminderDueSent = true;
    }
    if (!allDone && parent.completed) {
      parent.completed = false;
      parent.completedAt = null;
      parent.updatedAt = fmtDateTime(nowDate());
      parent.reminder5Sent = false;
      parent.reminderDueSent = false;
    }
  }
}

function validateDdlForMode(ddlDate) {
  const now = nowDate();
  if (ddlDate <= now) {
    return "DDL必须晚于当前系统时间";
  }

  if (state.mode === "create_subtask") {
    const parent = findTask(state.modeTargetId);
    if (!parent) return "父任务不存在";
    if (ddlDate >= parseDateTime(parent.ddl)) {
      return "子任务DDL必须早于父任务DDL";
    }
  }

  if (state.mode === "edit_subtask") {
    const sub = findTask(state.modeTargetId);
    if (!sub || !sub.parentId) return "子任务不存在";
    const parent = findTask(sub.parentId);
    if (!parent) return "父任务不存在";
    if (ddlDate >= parseDateTime(parent.ddl)) {
      return "子任务DDL必须早于父任务DDL";
    }
  }

  if (state.mode === "edit_parent") {
    const parent = findTask(state.modeTargetId);
    if (!parent) return "父任务不存在";
    const subs = state.tasks.filter((t) => t.parentId === parent.id);
    if (subs.some((s) => ddlDate <= parseDateTime(s.ddl))) {
      return "父任务DDL必须晚于全部子任务DDL";
    }
  }

  return "";
}

function submitTask() {
  const title = el.subjectInput.value.trim();
  const ddlText = el.ddlInput.value.trim();
  const content = el.contentInput.value.trim();
  if (!title) {
    toast("请输入任务主题");
    return;
  }
  const ddlDate = parseDateTime(ddlText);
  if (!ddlDate) {
    toast("DDL格式错误，请使用选择DDL");
    return;
  }
  const err = validateDdlForMode(ddlDate);
  if (err) {
    toast(err);
    return;
  }

  const nowText = fmtDateTime(nowDate());
  if (state.mode === "create_parent") {
    state.tasks.push({
      id: randomId(),
      parentId: null,
      title,
      content,
      ddl: fmtDateTime(ddlDate),
      completed: false,
      completedAt: null,
      createdAt: nowText,
      updatedAt: nowText,
      reminder5Sent: false,
      reminderDueSent: false,
    });
  } else if (state.mode === "create_subtask") {
    const parent = findTask(state.modeTargetId);
    if (!parent) {
      toast("父任务不存在");
      return;
    }
    state.tasks.push({
      id: randomId(),
      parentId: parent.id,
      title,
      content,
      ddl: fmtDateTime(ddlDate),
      completed: false,
      completedAt: null,
      createdAt: nowText,
      updatedAt: nowText,
      reminder5Sent: false,
      reminderDueSent: false,
    });
    parent.completed = false;
    parent.completedAt = null;
    parent.updatedAt = nowText;
    parent.reminder5Sent = false;
    parent.reminderDueSent = false;
  } else if (state.mode === "edit_parent" || state.mode === "edit_subtask") {
    const target = findTask(state.modeTargetId);
    if (!target) {
      toast("任务不存在");
      return;
    }
    target.title = title;
    target.content = content;
    target.ddl = fmtDateTime(ddlDate);
    target.updatedAt = nowText;
    target.reminder5Sent = false;
    target.reminderDueSent = false;
  }

  syncParentCompletion();
  saveTasks();
  resetComposer();
  renderTaskList();
}

function beginEdit(taskId) {
  const task = findTask(taskId);
  if (!task) return;
  el.subjectInput.value = task.title;
  el.ddlInput.value = task.ddl;
  el.contentInput.value = task.content;
  setMode(task.parentId ? "edit_subtask" : "edit_parent", task.id);
}

function beginCreateSubtask(parentId) {
  const parent = findTask(parentId);
  if (!parent) return;
  resetComposer();
  setMode("create_subtask", parent.id);
  el.subjectInput.focus();
}

function deleteTask(taskId) {
  const target = findTask(taskId);
  if (!target) return;
  const ok = window.confirm("确定删除该任务吗？");
  if (!ok) return;
  const toDelete = new Set([taskId]);
  if (!target.parentId) {
    state.tasks.filter((t) => t.parentId === target.id).forEach((sub) => toDelete.add(sub.id));
  }
  state.tasks = state.tasks.filter((t) => !toDelete.has(t.id));
  toDelete.forEach((id) => {
    state.expandedTaskIds.delete(id);
    state.expandedSubtaskGroups.delete(id);
  });
  syncParentCompletion();
  saveTasks();
  renderTaskList();
}

function completeTask(taskId) {
  const task = findTask(taskId);
  if (!task || task.completed) return;
  if (!task.parentId && childrenOf(task.id).length > 0) {
    toast("父任务有子任务时，不能手动完成");
    return;
  }
  task.completed = true;
  task.completedAt = fmtDateTime(nowDate());
  task.updatedAt = task.completedAt;
  task.reminder5Sent = true;
  task.reminderDueSent = true;
  syncParentCompletion();
  saveTasks();
  renderTaskList();
}

function toggleExpand(taskId) {
  if (state.expandedTaskIds.has(taskId)) {
    state.expandedTaskIds.delete(taskId);
  } else {
    state.expandedTaskIds.add(taskId);
  }
  renderTaskList();
}

function toggleSubtaskGroup(parentId) {
  if (state.expandedSubtaskGroups.has(parentId)) {
    state.expandedSubtaskGroups.delete(parentId);
  } else {
    state.expandedSubtaskGroups.add(parentId);
  }
  renderTaskList();
}

function colorClassForTask(task) {
  if (task.completed) return "color-gray";
  const ddl = effectiveDdl(task);
  const remain = ddl.getTime() - nowDate().getTime();
  if (remain < 0) return "color-blue";
  if (remain <= 24 * 3600 * 1000) return "color-red";
  if (remain <= 72 * 3600 * 1000) return "color-yellow";
  return "color-green";
}

function taskSummaryText(task) {
  if (task.completed && task.completedAt) {
    return `于 ${task.completedAt} 完成`;
  }
  const delta = humanDelta(effectiveDdl(task));
  if (delta.overdue) {
    return `超出DDL ${delta.text}`;
  }
  return `距离DDL ${delta.text}`;
}

function shouldOnlyDelete(task) {
  return task.completed || effectiveDdl(task) < nowDate();
}

function createActionButton(icon, title, className, onClick) {
  const btn = document.createElement("button");
  btn.className = `icon-btn ${className || ""}`.trim();
  btn.type = "button";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.textContent = icon;
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function renderTaskCard(task, host, isSubtask = false) {
  const fragment = el.taskCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".task-card");
  const main = fragment.querySelector(".task-main");
  const titleRow = fragment.querySelector(".task-title-row");
  const titleEl = fragment.querySelector(".task-title");
  const subCountEl = fragment.querySelector(".task-sub-count");
  const timeEl = fragment.querySelector(".task-time");
  const actionsEl = fragment.querySelector(".task-actions");

  card.classList.add(colorClassForTask(task));
  if (isSubtask) {
    card.classList.add("subtask-card");
  }
  titleEl.textContent = task.title || "(未命名任务)";
  timeEl.textContent = taskSummaryText(task);

  const subs = isSubtask ? [] : childrenOf(task.id);
  if (subs.length) {
    subCountEl.textContent = `- 包含 ${subs.length} 项子任务`;
  } else {
    subCountEl.textContent = "";
  }

  if (shouldOnlyDelete(task)) {
    actionsEl.appendChild(createActionButton("🗑", "删除任务", "delete", () => deleteTask(task.id)));
  } else {
    actionsEl.appendChild(createActionButton("✏", "修改任务", "", () => beginEdit(task.id)));
    if (!isSubtask) {
      actionsEl.appendChild(createActionButton("＋", "添加子任务", "", () => beginCreateSubtask(task.id)));
    }
    actionsEl.appendChild(createActionButton("🗑", "删除任务", "delete", () => deleteTask(task.id)));
  }

  main.addEventListener("click", () => toggleExpand(task.id));

  if (state.expandedTaskIds.has(task.id)) {
    card.classList.add("expanded");
    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "collapse-side collapse-left";
    collapseBtn.title = "收起";
    collapseBtn.setAttribute("aria-label", "收起");
    collapseBtn.textContent = "⌃";
    collapseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleExpand(task.id);
    });
    card.appendChild(collapseBtn);
    if (titleRow) {
      titleRow.style.paddingLeft = "24px";
    }

    const detail = document.createElement("div");
    detail.className = "task-detail";
    const ddlLine = document.createElement("p");
    ddlLine.className = "detail-line";
    ddlLine.textContent = `最终期限：${task.ddl}`;
    const contentLine = document.createElement("p");
    contentLine.className = "detail-line";
    contentLine.textContent = `任务内容：${task.content || "（无）"}`;
    detail.appendChild(ddlLine);
    detail.appendChild(contentLine);

    if (!isSubtask && subs.length) {
      const done = subs.filter((s) => s.completed).length;
      const subWrap = document.createElement("div");
      subWrap.className = "subtask-toggle";
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "subtask-toggle-btn";
      toggleBtn.textContent = `子任务 已完成 ${done}/${subs.length}（点击展开/收起）`;
      toggleBtn.addEventListener("click", () => toggleSubtaskGroup(task.id));
      subWrap.appendChild(toggleBtn);
      detail.appendChild(subWrap);

      if (state.expandedSubtaskGroups.has(task.id)) {
        const subList = document.createElement("div");
        subList.className = "subtask-list";
        for (const sub of subs) {
          renderTaskCard(sub, subList, true);
        }
        detail.appendChild(subList);
      }
    }

    const canComplete = (!task.completed && (isSubtask || (!isSubtask && subs.length === 0)));
    if (canComplete) {
      const completeBtn = document.createElement("button");
      completeBtn.type = "button";
      completeBtn.className = "complete-btn";
      completeBtn.textContent = "完成任务";
      completeBtn.addEventListener("click", () => completeTask(task.id));
      detail.appendChild(completeBtn);
    }
    card.appendChild(detail);
  }

  host.appendChild(fragment);
}

function renderTaskList() {
  el.taskList.innerHTML = "";
  const parents = state.tasks.filter((t) => !t.parentId);
  parents.sort((a, b) => taskSortKey(a) - taskSortKey(b));
  if (!parents.length) {
    const hint = document.createElement("div");
    hint.className = "empty-hint";
    hint.textContent = "暂无任务，先在下方输入框创建一个吧";
    el.taskList.appendChild(hint);
    return;
  }
  parents.forEach((task) => renderTaskCard(task, el.taskList, false));
}

function openDdlModal() {
  const parsed = parseDateTime(el.ddlInput.value.trim()) || new Date(nowDate().getTime() + 60 * 60 * 1000);
  el.ddlDateInput.value = dateInputValue(parsed);
  el.ddlTimeInput.value = timeInputValue(parsed);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区";
  el.timezoneText.textContent = `时区：${tz}`;
  el.ddlModal.classList.remove("hidden");
}

function closeDdlModal() {
  el.ddlModal.classList.add("hidden");
}

function confirmDdl() {
  const picked = parseDateAndTime(el.ddlDateInput.value, el.ddlTimeInput.value);
  if (!picked) {
    toast("请选择合法日期和时间");
    return;
  }
  el.ddlInput.value = fmtDateTime(picked);
  closeDdlModal();
}

function showReminderModal(lines) {
  if (!lines.length) return;
  el.reminderBody.textContent = lines.join("\n");
  el.reminderModal.classList.remove("hidden");
}

function closeReminderModal() {
  el.reminderModal.classList.add("hidden");
}

function checkReminders() {
  if (!state.currentUser) return;
  const now = nowDate();
  const lines = [];
  let changed = false;
  for (const task of state.tasks) {
    if (task.completed) continue;
    const ddl = parseDateTime(task.ddl);
    if (!ddl) continue;
    if (!task.reminder5Sent && now.getTime() >= ddl.getTime() - 5 * 60 * 1000) {
      task.reminder5Sent = true;
      changed = true;
      lines.push(`【5分钟提醒】任务“${task.title}”即将到期（DDL: ${task.ddl}）`);
    }
    if (!task.reminderDueSent && now.getTime() >= ddl.getTime()) {
      task.reminderDueSent = true;
      changed = true;
      lines.push(`【到期提醒】任务“${task.title}”已到DDL（${task.ddl}）`);
    }
  }
  if (changed) {
    saveTasks();
    renderTaskList();
  }
  if (lines.length) {
    showReminderModal(lines);
  }
}

async function tryRestoreSession() {
  const username = localStorage.getItem(STORAGE_SESSION_KEY);
  if (!username) {
    setAuthVisible(true);
    return;
  }
  try {
    state.currentUser = username;
    state.tasks = await loadTasksFromServer(username);
    el.accountLabel.textContent = `当前账户：${username}`;
    setAuthVisible(false);
    resetComposer();
    renderTaskList();
  } catch {
    state.currentUser = null;
    state.tasks = [];
    setAuthVisible(true);
    saveSession(null);
  }
}

function bindEvents() {
  el.registerBtn.addEventListener("click", register);
  el.loginBtn.addEventListener("click", login);
  el.switchBtn.addEventListener("click", logout);
  el.logoutBtn.addEventListener("click", logout);
  el.submitTaskBtn.addEventListener("click", submitTask);
  el.cancelModeBtn.addEventListener("click", resetComposer);
  el.pickDdlBtn.addEventListener("click", openDdlModal);
  el.ddlInput.addEventListener("click", openDdlModal);
  el.cancelDdlBtn.addEventListener("click", closeDdlModal);
  el.confirmDdlBtn.addEventListener("click", confirmDdl);
  el.closeReminderBtn.addEventListener("click", closeReminderModal);

  el.ddlModal.addEventListener("click", (event) => {
    if (event.target === el.ddlModal) closeDdlModal();
  });
  el.reminderModal.addEventListener("click", (event) => {
    if (event.target === el.reminderModal) closeReminderModal();
  });

  el.authPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") login();
  });
  el.contentInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") submitTask();
  });

  window.addEventListener("beforeunload", () => {
    if (!state.currentUser) return;
    const body = JSON.stringify({ username: state.currentUser, tasks: state.tasks });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API.saveTasks, new Blob([body], { type: "application/json" }));
    } else {
      fetch(API.saveTasks, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  });
}

async function boot() {
  bindEvents();
  try {
    await apiJson(API.health);
  } catch {
    toast("本地数据服务未启动，请先运行: python server.py");
  }
  await tryRestoreSession();
  window.setInterval(checkReminders, 20 * 1000);
  window.setInterval(() => {
    if (state.currentUser) {
      renderTaskList();
    }
  }, 60 * 1000);
}

void boot();
