'use strict';

/* ------------------------------------------------------------------
   DeskNote 文案表（渲染进程 + 主进程共用）
   - 三种语言：简体中文 zh-CN / 繁體中文 zh-TW / English en
   - 静态文案：HTML 上写 data-i18n / data-i18n-title / data-i18n-ph
   - 动态文案：app.js / main.js 里调 t(键名, 参数)
   - 日期、相对时间、星期这些跟语序强相关的，在这里按语言拼好再给出去
   ------------------------------------------------------------------ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.i18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LANGS = [
    { id: 'zh-CN', label: '简体中文', htmlLang: 'zh-CN' },
    { id: 'zh-TW', label: '繁體中文', htmlLang: 'zh-TW' },
    { id: 'en', label: 'English', htmlLang: 'en' },
  ];

  const DICT = {
    /* ------------------------------ 简体中文 ------------------------------ */
    'zh-CN': {
      'mini.expand': '展开便签',
      'mini.todo': '{n} 条待办',
      'mini.todoNext': '{n} 条待办 · 最近：{title}',

      'header.loading': '载入中',
      'header.hide': '收起为迷你条',
      'header.close': '退出 DeskNote（Ctrl+Alt+N 只隐藏不退出）',
      'nextup.label': '下一个',

      'ed.titlePh': '任务名称，如：论文初稿',
      'ed.hasDue': '设置截止日期（不勾就是没有期限的待办）',
      'ed.dueDate': '截止日期',
      'ed.dueTime': '截止时间',
      'ed.hasStart': '设置最迟开始时间（可选，勾选后从该时间开始每天提醒）',
      'ed.startDate': '最迟开始',
      'ed.startTime': '开始时间',
      'ed.repeat': '重复',
      'ed.repeatNone': '不重复',
      'ed.repeatWeekly': '每周（可多天）',
      'ed.repeatDaily': '每天',
      'ed.remindAt': '每天提醒时间',
      'ed.repeatMonthly': '每月（可多天）',
      'ed.monthlyMonths': '哪几个月（不选＝每个月）',
      'ed.monthDays': '每月哪几号（用逗号隔开，如 3, 9, 21）',
      'ed.monthDaysHint': '没有这一天的月份按当月最后一天提醒（如 2 月没有 31 号）',
      'ed.repeatDays': '每周哪几天（可多选）',
      'ed.cancel': '取消',
      'ed.add': '添加',
      'ed.save': '保存',

      'day.0': '周日',
      'day.1': '周一',
      'day.2': '周二',
      'day.3': '周三',
      'day.4': '周四',
      'day.5': '周五',
      'day.6': '周六',
      'day.0.tip': '每周日提醒（点击切换）',
      'day.1.tip': '每周一提醒（点击切换）',
      'day.2.tip': '每周二提醒（点击切换）',
      'day.3.tip': '每周三提醒（点击切换）',
      'day.4.tip': '每周四提醒（点击切换）',
      'day.5.tip': '每周五提醒（点击切换）',
      'day.6.tip': '每周六提醒（点击切换）',

      'foot.add': '新建任务',
      'foot.settings': '设置',

      'sp.lang': '语言',
      'sp.theme': '皮肤',
      'theme.paper': '纸白',
      'theme.night': '夜间',
      'theme.mint': '薄荷',
      'theme.indigo': '靛蓝',
      'theme.rose': '樱粉',
      'theme.sand': '暖沙',
      'theme.graphite': '墨黑',
      'theme.sky': '晴空',
      'sp.bg': '背景',
      'sp.bgPick': '选择图片',
      'sp.bgClear': '清除背景',
      'sp.scale': '缩放',
      'sp.hotkey': '显隐',
      'sp.hotkeyTip': '点击后按下新的组合键',
      'sp.hotkeyReset': '默认',
      'sp.hotkeyResetTip': '恢复默认 Ctrl + Alt + N',
      'sp.autostart': '自启',
      'sp.autostartTip': '开机自动启动',
      'sp.fullscreen': '全屏',
      'sp.fullscreenHint': '全屏时自动隐藏',
      'sp.plugins': '插件',
      'sp.pluginsManage': '插件管理',
      'plugin.title': '插件管理',
      'plugin.empty': '还没有安装插件',
      'plugin.note': '开关立即生效；垃圾桶可卸载插件',
      'plugin.remove': '卸载插件',
      'plugin.removeConfirm': '卸载插件「{name}」？插件文件会被删除。',
      'bg.blockedByWallpaper': '壁纸穿透开启时不可用',
      'plugin.close': '关闭',
      'plugin.noWallpaper': '没读到静态壁纸（Wallpaper Engine 动态壁纸暂不支持）',
      'plugin.capture': '屏幕取景（实验）',
      'plugin.lowPower': '省电模式（10fps / 720p）',
      'plugin.captureFail': '屏幕取景失败，已回退静态壁纸',
      'plugin.engine': '读取 Wallpaper Engine 项目',
      'plugin.engineNote': '只支持 .mp4 / .webm 视频壁纸（自动循环播放）；场景、网页等其它类型的项目只显示自带的预览图。',
      'plugin.bgConflict': '⚠ 使用时无法使用自定义便签背景',
      'plugin.engineFail': '没读到 Wallpaper Engine 壁纸',
      'sp.restart': '重启便签',
      'sp.version': '版本',
      'sp.checkUpdate': '检查更新',
      'update.checking': '检查中…',
      'update.latest': '已是最新版本 v{v}',
      'update.found': '发现新版本 v{v}',
      'update.download': '下载 v{v}',
      'update.fail': '检查更新失败：{e}',
      'update.failTimeout': '网络超时，稍后再试',
      'update.openFail': '下载页打不开，请手动打开',
      'sp.restartTip': '重启便签进程',
      'sp.data': '数据',
      'sp.export': '导出',
      'sp.import': '导入',
      'sp.footText': '文案',
      'sp.footTextPh': '留空显示版本号',
      'sp.footFont': '字体',
      'sp.footItalic': '斜体',
      'dialog.exportTitle': '导出任务数据',
      'dialog.importTitle': '导入任务数据',
      'dialog.jsonFilter': 'JSON 文件',
      'export.done': '已导出 {n} 条任务',
      'export.fail': '导出失败',
      'import.ok': '已导入 {n} 条任务',
      'import.none': '没有新任务（{n} 条已存在）',
      'import.skipped': '跳过 {n} 条重复',
      'import.confirm': '将导入 {n} 条任务，现有任务不会被删除',
      'import.confirmSkip': '另有 {n} 条与现有任务重复，会自动跳过',
      'import.yes': '导入',
      'import.no': '取消',
      'import.bad': '这个文件不是 DeskNote 的备份格式',
      'import.json': '文件不是有效的 JSON',
      'import.tooMany': '文件里任务太多（上限 {max} 条）',
      'import.fail': '导入失败',

      'sub.over': '逾期 {n}',
      'sub.today': '今天 {n}',
      'sub.tomorrow': '明天 {n}',
      'sub.week': '本周 {n}',
      'sub.active': '{n} 项待办',
      'sub.clear': '清空了，休息一下',

      'nu.remind': '提醒',
      'nu.more': '等 {n} 项',
      'nu.left': '剩 {n} 天',
      'nu.daily': '今天要做',
      'nu.allday': '全天',

      'group.over': '已逾期',
      'group.today': '今天',
      'group.tomorrow': '明天',
      'group.week': '本周内',
      'group.later': '更远 / 无日期',
      'group.done': '已完成',

      'task.doneBadge': '已完成',
      'task.noDue': '无期限',
      'task.bellTip': '倒计时中，每天提醒',
      'task.repeatTag': '每周',
      'task.repeatTipDaily': '每天重复',
      'task.repeatTagDaily': '每天',
      'task.repeatTagMonthly': '每月',
      'task.repeatTipMonthly': '每月重复（按几号）',
      'task.tipEdit': '右键可修改',
      'task.tipStart': '最迟开始 {date}',
      'task.markDone': '标记完成',
      'task.markUndone': '标记为未完成',
      'task.del': '删除',
      'task.dueMeta': '截止 {when}',
      'task.repeatTip': '每周重复',

      'due.withTime': '{md} {time}',
      'due.allDay': '{md} 全天',

      'empty.title': '没有待办',
      'empty.hint': '点左下角的 + 新建一个',

      'done.show': '已完成 {n} 项 · 展开',
      'done.hide': '收起已完成',

      'notify.title': '今天有 {n} 项要推进',
      'notify.line': '· {title}（{state}）',
      'notify.daily': '今天要做',
      'notify.overdue': '已逾期',
      'notify.left': '剩 {n} 天',

      'hotkey.press': '按下组合键…',
      'hotkey.conflict': '冲突，换一个',

      'rel.justOver': '刚刚过期',
      'rel.overMin': '已逾期 {n} 分',
      'rel.overHour': '已逾期 {n} 小时',
      'rel.overDay': '已逾期 {n} 天',
      'rel.dueNow': '即将到点',
      'rel.leftMin': '还有 {n} 分',
      'rel.leftHourMin': '还有 {h} 小时 {m} 分',
      'rel.leftHour': '还有 {n} 小时',
      'rel.leftDay': '还有 {n} 天',

      'initFailed': '初始化失败',

      'tray.show': '显示便签',
      'tray.hide': '隐藏便签',
      'tray.hotkey': '快捷键  {accel}',
      'tray.autostart': '开机自启动',
      'tray.alwaysOnTop': '始终置顶',
      'tray.restart': '重启便签',
      'tray.quit': '退出',
      'tray.tip': 'DeskNote 便签 · {hotkey} 显隐',
      'tray.balloonTitle': 'DeskNote 已隐藏到托盘',
      'tray.balloonBody': '右键托盘图标可显示/退出；按 Ctrl+Alt+N 也能唤回',
      'dialog.bgTitle': '选择背景图片',
      'dialog.images': '图片',
      'crop.title': '选择背景区域',
      'crop.hint': '拖动调整位置 · 滚轮缩放',
      'crop.fade': '浓度',
      'crop.reset': '重置',
      'crop.cancel': '取消',
      'crop.apply': '确定',
      'crop.failed': '这张图片读不出来',
    },

    /* ------------------------------ 繁體中文 ------------------------------ */
    'zh-TW': {
      'mini.expand': '展開便籤',
      'mini.todo': '{n} 條待辦',
      'mini.todoNext': '{n} 條待辦 · 最近：{title}',

      'header.loading': '載入中',
      'header.hide': '收合為迷你列',
      'header.close': '結束 DeskNote（Ctrl+Alt+N 只是隱藏）',
      'nextup.label': '下一個',

      'ed.titlePh': '任務名稱，例如：論文初稿',
      'ed.hasDue': '設定截止日期（不勾就是沒有期限的待辦）',
      'ed.dueDate': '截止日期',
      'ed.dueTime': '截止時間',
      'ed.hasStart': '設定最遲開始時間（選填，勾選後從該時間起每天提醒）',
      'ed.startDate': '最遲開始',
      'ed.startTime': '開始時間',
      'ed.repeat': '重複',
      'ed.repeatNone': '不重複',
      'ed.repeatWeekly': '每週（可多天）',
      'ed.repeatDaily': '每天',
      'ed.remindAt': '每天提醒時間',
      'ed.repeatMonthly': '每月（可多天）',
      'ed.monthlyMonths': '哪幾個月（不選＝每個月）',
      'ed.monthDays': '每月哪幾號（用逗號隔開，如 3, 9, 21）',
      'ed.monthDaysHint': '沒有這一天的月份按當月最後一天提醒（如 2 月沒有 31 號）',
      'ed.repeatDays': '每週哪幾天（可多選）',
      'ed.cancel': '取消',
      'ed.add': '新增',
      'ed.save': '儲存',

      'day.0': '週日',
      'day.1': '週一',
      'day.2': '週二',
      'day.3': '週三',
      'day.4': '週四',
      'day.5': '週五',
      'day.6': '週六',
      'day.0.tip': '每週日提醒（點擊切換）',
      'day.1.tip': '每週一提醒（點擊切換）',
      'day.2.tip': '每週二提醒（點擊切換）',
      'day.3.tip': '每週三提醒（點擊切換）',
      'day.4.tip': '每週四提醒（點擊切換）',
      'day.5.tip': '每週五提醒（點擊切換）',
      'day.6.tip': '每週六提醒（點擊切換）',

      'foot.add': '新增任務',
      'foot.settings': '設定',

      'sp.lang': '語言',
      'sp.theme': '外觀',
      'theme.paper': '紙白',
      'theme.night': '夜間',
      'theme.mint': '薄荷',
      'theme.indigo': '靛藍',
      'theme.rose': '櫻粉',
      'theme.sand': '暖沙',
      'theme.graphite': '墨黑',
      'theme.sky': '晴空',
      'sp.bg': '背景',
      'sp.bgPick': '選擇圖片',
      'sp.bgClear': '清除背景',
      'sp.scale': '縮放',
      'sp.hotkey': '顯隱',
      'sp.hotkeyTip': '點擊後按下新的組合鍵',
      'sp.hotkeyReset': '預設',
      'sp.hotkeyResetTip': '還原預設 Ctrl + Alt + N',
      'sp.autostart': '自啟',
      'sp.autostartTip': '開機自動啟動',
      'sp.fullscreen': '全螢幕',
      'sp.fullscreenHint': '全螢幕時自動隱藏',
      'sp.plugins': '外掛',
      'sp.pluginsManage': '外掛管理',
      'plugin.title': '外掛管理',
      'plugin.empty': '還沒有安裝外掛',
      'plugin.note': '開關立即生效；垃圾桶可移除外掛',
      'plugin.remove': '移除外掛',
      'plugin.removeConfirm': '移除外掛「{name}」？外掛檔案會被刪除。',
      'bg.blockedByWallpaper': '桌布穿透開啟時不可用',
      'plugin.close': '關閉',
      'plugin.noWallpaper': '沒讀到靜態桌布（Wallpaper Engine 動態桌布暫不支援）',
      'plugin.capture': '螢幕取景（實驗）',
      'plugin.lowPower': '省電模式（10fps / 720p）',
      'plugin.captureFail': '螢幕取景失敗，已退回靜態桌布',
      'plugin.engine': '讀取 Wallpaper Engine 專案',
      'plugin.engineNote': '只支援 .mp4 / .webm 影片桌布（自動循環播放）；場景、網頁等其他類型的專案只顯示內附的預覽圖。',
      'plugin.bgConflict': '⚠ 使用時無法使用自訂便籤背景',
      'plugin.engineFail': '沒讀到 Wallpaper Engine 桌布',
      'sp.restart': '重新啟動',
      'sp.version': '版本',
      'sp.checkUpdate': '檢查更新',
      'update.checking': '檢查中…',
      'update.latest': '已是最新版本 v{v}',
      'update.found': '發現新版本 v{v}',
      'update.download': '下載 v{v}',
      'update.fail': '檢查更新失敗：{e}',
      'update.failTimeout': '網路逾時，稍後再試',
      'update.openFail': '下載頁打不開，請手動開啟',
      'sp.restartTip': '重新啟動便籤程序',
      'sp.data': '資料',
      'sp.export': '匯出',
      'sp.import': '匯入',
      'sp.footText': '文案',
      'sp.footTextPh': '留空顯示版本號',
      'sp.footFont': '字體',
      'sp.footItalic': '斜體',
      'dialog.exportTitle': '匯出任務資料',
      'dialog.importTitle': '匯入任務資料',
      'dialog.jsonFilter': 'JSON 檔案',
      'export.done': '已匯出 {n} 項任務',
      'export.fail': '匯出失敗',
      'import.ok': '已匯入 {n} 項任務',
      'import.none': '沒有新任務（{n} 項已存在）',
      'import.skipped': '略過 {n} 項重複',
      'import.confirm': '將匯入 {n} 項任務，現有任務不會被刪除',
      'import.confirmSkip': '另有 {n} 項與現有任務重複，會自動略過',
      'import.yes': '匯入',
      'import.no': '取消',
      'import.bad': '這個檔案不是 DeskNote 的備份格式',
      'import.json': '檔案不是有效的 JSON',
      'import.tooMany': '檔案裡任務太多（上限 {max} 項）',
      'import.fail': '匯入失敗',

      'sub.over': '逾期 {n}',
      'sub.today': '今天 {n}',
      'sub.tomorrow': '明天 {n}',
      'sub.week': '本週 {n}',
      'sub.active': '{n} 項待辦',
      'sub.clear': '清空了，休息一下',

      'nu.remind': '提醒',
      'nu.more': '等 {n} 項',
      'nu.left': '剩 {n} 天',
      'nu.daily': '今天要做',
      'nu.allday': '整天',

      'group.over': '已逾期',
      'group.today': '今天',
      'group.tomorrow': '明天',
      'group.week': '本週內',
      'group.later': '更遠 / 無日期',
      'group.done': '已完成',

      'task.doneBadge': '已完成',
      'task.noDue': '無期限',
      'task.bellTip': '倒數中，每天提醒',
      'task.repeatTag': '每週',
      'task.repeatTipDaily': '每天重複',
      'task.repeatTagDaily': '每天',
      'task.repeatTagMonthly': '每月',
      'task.repeatTipMonthly': '每月重複（按幾號）',
      'task.tipEdit': '右鍵可修改',
      'task.tipStart': '最遲開始 {date}',
      'task.markDone': '標記完成',
      'task.markUndone': '標記為未完成',
      'task.del': '刪除',
      'task.dueMeta': '截止 {when}',
      'task.repeatTip': '每週重複',

      'due.withTime': '{md} {time}',
      'due.allDay': '{md} 整天',

      'empty.title': '沒有待辦',
      'empty.hint': '點左下角的 + 新增一個',

      'done.show': '已完成 {n} 項 · 展開',
      'done.hide': '收合已完成',

      'notify.title': '今天有 {n} 項要推進',
      'notify.line': '· {title}（{state}）',
      'notify.daily': '今天要做',
      'notify.overdue': '已逾期',
      'notify.left': '剩 {n} 天',

      'hotkey.press': '按下組合鍵…',
      'hotkey.conflict': '衝突，換一個',

      'rel.justOver': '剛剛過期',
      'rel.overMin': '已逾期 {n} 分',
      'rel.overHour': '已逾期 {n} 小時',
      'rel.overDay': '已逾期 {n} 天',
      'rel.dueNow': '即將到點',
      'rel.leftMin': '還有 {n} 分',
      'rel.leftHourMin': '還有 {h} 小時 {m} 分',
      'rel.leftHour': '還有 {n} 小時',
      'rel.leftDay': '還有 {n} 天',

      'initFailed': '初始化失敗',

      'tray.show': '顯示便籤',
      'tray.hide': '隱藏便籤',
      'tray.hotkey': '快捷鍵  {accel}',
      'tray.autostart': '開機自動啟動',
      'tray.alwaysOnTop': '始終置頂',
      'tray.restart': '重新啟動',
      'tray.quit': '結束',
      'tray.tip': 'DeskNote 便籤 · {hotkey} 顯隱',
      'tray.balloonTitle': 'DeskNote 已隱藏到系統匣',
      'tray.balloonBody': '右鍵系統匣圖示可顯示/結束；按 Ctrl+Alt+N 也能喚回',
      'dialog.bgTitle': '選擇背景圖片',
      'dialog.images': '圖片',
      'crop.title': '選擇背景區域',
      'crop.hint': '拖曳調整位置 · 滾輪縮放',
      'crop.fade': '濃度',
      'crop.reset': '重設',
      'crop.cancel': '取消',
      'crop.apply': '確定',
      'crop.failed': '這張圖片讀不出來',
    },

    /* ------------------------------- English ------------------------------- */
    en: {
      'mini.expand': 'Expand',
      'mini.todo': '{n} open',
      'mini.todoNext': '{n} open · next: {title}',

      'header.loading': 'Loading',
      'header.hide': 'Collapse to mini bar',
      'header.close': 'Quit DeskNote (Ctrl+Alt+N only hides it)',
      'nextup.label': 'Next',

      'ed.titlePh': 'Task name, e.g. Thesis draft',
      'ed.hasDue': 'Set a due date (uncheck for a task without a deadline)',
      'ed.dueDate': 'Due date',
      'ed.dueTime': 'Due time',
      'ed.hasStart': 'Optional latest start (daily reminders from then on)',
      'ed.startDate': 'Latest start',
      'ed.startTime': 'Start time',
      'ed.repeat': 'Repeat',
      'ed.repeatNone': 'Never',
      'ed.repeatWeekly': 'Weekly (multi-day)',
      'ed.repeatDaily': 'Daily',
      'ed.remindAt': 'Daily reminder time',
      'ed.repeatMonthly': 'Monthly (multi-day)',
      'ed.monthlyMonths': 'Months (empty = every month)',
      'ed.monthDays': 'Days of the month (comma separated, e.g. 3, 9, 21)',
      'ed.monthDaysHint': 'Months without that day fall back to the last day (e.g. no 31st in February)',
      'ed.repeatDays': 'Days of the week (multi-select)',
      'ed.cancel': 'Cancel',
      'ed.add': 'Add',
      'ed.save': 'Save',

      'day.0': 'Sun',
      'day.1': 'Mon',
      'day.2': 'Tue',
      'day.3': 'Wed',
      'day.4': 'Thu',
      'day.5': 'Fri',
      'day.6': 'Sat',
      'day.0.tip': 'Remind every Sunday (click to toggle)',
      'day.1.tip': 'Remind every Monday (click to toggle)',
      'day.2.tip': 'Remind every Tuesday (click to toggle)',
      'day.3.tip': 'Remind every Wednesday (click to toggle)',
      'day.4.tip': 'Remind every Thursday (click to toggle)',
      'day.5.tip': 'Remind every Friday (click to toggle)',
      'day.6.tip': 'Remind every Saturday (click to toggle)',

      'foot.add': 'New task',
      'foot.settings': 'Settings',

      'sp.lang': 'Lang',
      'sp.theme': 'Skin',
      'theme.paper': 'Paper',
      'theme.night': 'Night',
      'theme.mint': 'Mint',
      'theme.indigo': 'Indigo',
      'theme.rose': 'Rose',
      'theme.sand': 'Sand',
      'theme.graphite': 'Graphite',
      'theme.sky': 'Sky',
      'sp.bg': 'BG',
      'sp.bgPick': 'Choose',
      'sp.bgClear': 'Clear',
      'sp.scale': 'Zoom',
      'sp.hotkey': 'Key',
      'sp.hotkeyTip': 'Click, then press a new shortcut',
      'sp.hotkeyReset': 'Default',
      'sp.hotkeyResetTip': 'Reset to the default Ctrl + Alt + N',
      'sp.autostart': 'Auto',
      'sp.autostartTip': 'Start on login',
      'sp.fullscreen': 'Full',
      'sp.fullscreenHint': 'Hide in fullscreen',
      'sp.plugins': 'Plugins',
      'sp.pluginsManage': 'Manage',
      'plugin.title': 'Plugins',
      'plugin.empty': 'No plugins installed',
      'plugin.note': 'Changes apply immediately; trash removes the plugin',
      'plugin.remove': 'Remove plugin',
      'plugin.removeConfirm': 'Remove plugin "{name}"? Its files will be deleted.',
      'bg.blockedByWallpaper': 'Disabled while wallpaper plugin is on',
      'plugin.close': 'Close',
      'plugin.noWallpaper': 'No static wallpaper found (animated Wallpaper Engine wallpapers are not supported yet)',
      'plugin.capture': 'Screen capture (experimental)',
      'plugin.lowPower': 'Low power (10fps / 720p)',
      'plugin.captureFail': 'Screen capture failed, fell back to static wallpaper',
      'plugin.engine': 'Read Wallpaper Engine project',
      'plugin.engineNote': 'Only .mp4 / .webm video wallpapers loop; scene, web and other project types show the bundled preview image.',
      'plugin.bgConflict': '⚠ Custom note background is unavailable while this plugin is on',
      'plugin.engineFail': 'No Wallpaper Engine wallpaper found',
      'sp.restart': 'Restart',
      'sp.version': 'Version',
      'sp.checkUpdate': 'Check updates',
      'update.checking': 'Checking…',
      'update.latest': 'Up to date (v{v})',
      'update.found': 'v{v} is available',
      'update.download': 'Download v{v}',
      'update.fail': 'Update check failed: {e}',
      'update.failTimeout': 'Network timed out, try again later',
      'update.openFail': 'Could not open the download page',
      'sp.restartTip': 'Restart the DeskNote process',
      'sp.data': 'Data',
      'sp.export': 'Export',
      'sp.import': 'Import',
      'sp.footText': 'Note',
      'sp.footTextPh': 'Empty = version',
      'sp.footFont': 'Font',
      'sp.footItalic': 'Italic',
      'dialog.exportTitle': 'Export tasks',
      'dialog.importTitle': 'Import tasks',
      'dialog.jsonFilter': 'JSON files',
      'export.done': 'Exported {n} tasks',
      'export.done.one': 'Exported 1 task',
      'export.fail': 'Export failed',
      'import.ok': 'Imported {n} tasks',
      'import.ok.one': 'Imported 1 task',
      'import.none': 'No new tasks ({n} already exist)',
      'import.skipped': 'Skipped {n} duplicates',
      'import.confirm': 'Import {n} tasks? Existing tasks are kept',
      'import.confirmSkip': '{n} more duplicate existing tasks and will be skipped',
      'import.yes': 'Import',
      'import.no': 'Cancel',
      'import.bad': 'This is not a DeskNote backup file',
      'import.json': 'This file is not valid JSON',
      'import.tooMany': 'Too many tasks in this file (limit {max})',
      'import.fail': 'Import failed',

      'sub.over': '{n} overdue',
      'sub.today': '{n} today',
      'sub.tomorrow': '{n} tomorrow',
      'sub.week': '{n} this week',
      'sub.active': '{n} open',
      'sub.clear': 'All clear — take a break',

      'nu.remind': 'Remind',
      'nu.more': '+{n} more',
      'nu.left': '{n} d left',
      'nu.daily': 'Due today',
      'nu.allday': 'All day',

      'group.over': 'OVERDUE',
      'group.today': 'TODAY',
      'group.tomorrow': 'TOMORROW',
      'group.week': 'THIS WEEK',
      'group.later': 'LATER',
      'group.done': 'DONE',

      'task.doneBadge': 'Done',
      'task.noDue': 'No due date',
      'task.bellTip': 'Counting down, daily reminder',
      'task.repeatTag': 'Weekly',
      'task.repeatTipDaily': 'Repeats every day',
      'task.repeatTagDaily': 'Daily',
      'task.repeatTagMonthly': 'Monthly',
      'task.repeatTipMonthly': 'Repeats every month on the selected dates',
      'task.tipEdit': 'Right-click to edit',
      'task.tipStart': 'Latest start {date}',
      'task.markDone': 'Mark done',
      'task.markUndone': 'Mark not done',
      'task.del': 'Delete',
      'task.dueMeta': 'Due {when}',
      'task.repeatTip': 'Repeats weekly',

      'due.withTime': '{md} · {time}',
      'due.allDay': '{md} · all day',

      'empty.title': 'No tasks',
      'empty.hint': 'Click + at the bottom left to add one',

      'done.show': '{n} done · show',
      'done.hide': 'Hide done',

      'notify.title': '{n} tasks to advance today',
      'notify.title.one': '1 task to advance today',
      'notify.line': '· {title} ({state})',
      'notify.daily': 'Due today',
      'notify.overdue': 'overdue',
      'notify.left': '{n} d left',

      'hotkey.press': 'Press a shortcut…',
      'hotkey.conflict': 'Taken — try another',

      'rel.justOver': 'just overdue',
      'rel.overMin': '{n} min overdue',
      'rel.overMin.one': '1 min overdue',
      'rel.overHour': '{n} h overdue',
      'rel.overHour.one': '1 h overdue',
      'rel.overDay': '{n} d overdue',
      'rel.overDay.one': '1 d overdue',
      'rel.dueNow': 'due now',
      'rel.leftMin': '{n} min left',
      'rel.leftMin.one': '1 min left',
      'rel.leftHourMin': '{h} h {m} min left',
      'rel.leftHour': '{n} h left',
      'rel.leftHour.one': '1 h left',
      'rel.leftDay': '{n} d left',
      'rel.leftDay.one': '1 d left',

      'initFailed': 'Failed to load',

      'tray.show': 'Show note',
      'tray.hide': 'Hide note',
      'tray.hotkey': 'Shortcut  {accel}',
      'tray.autostart': 'Start on login',
      'tray.alwaysOnTop': 'Always on top',
      'tray.restart': 'Restart',
      'tray.quit': 'Quit',
      'tray.tip': 'DeskNote · {hotkey} to show/hide',
      'tray.balloonTitle': 'DeskNote is now in the tray',
      'tray.balloonBody': 'Right-click the tray icon to show or quit; Ctrl+Alt+N also brings it back',
      'dialog.bgTitle': 'Choose a background image',
      'dialog.images': 'Images',
      'crop.title': 'Choose background',
      'crop.hint': 'Drag to reposition · scroll to zoom',
      'crop.fade': 'Dim',
      'crop.reset': 'Reset',
      'crop.cancel': 'Cancel',
      'crop.apply': 'Apply',
      'crop.failed': "Can't read this image",
    },
  };

  const WEEK_SHORT = {
    'zh-CN': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    'zh-TW': ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  };
  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let lang = 'zh-CN';

  function setLang(next) {
    lang = Object.prototype.hasOwnProperty.call(DICT, next) ? next : 'zh-CN';
    return lang;
  }

  function getLang() {
    return lang;
  }

  function htmlLang() {
    return (LANGS.find((l) => l.id === lang) || LANGS[0]).htmlLang;
  }

  function raw(key) {
    let s = DICT[lang][key];
    if (s == null && /\.one$/.test(key)) s = DICT[lang][key.slice(0, -4)];
    if (s == null) s = DICT['zh-CN'][key];
    if (s == null && /\.one$/.test(key)) s = DICT['zh-CN'][key.slice(0, -4)];
    return s;
  }

  function t(key, params) {
    const s = raw(key);
    if (s == null) return key;
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
  }

  // 英文单复数：先找 key.one，找不到退回 key
  function tCount(key, n, params) {
    return t(n === 1 ? key + '.one' : key, Object.assign({ n }, params || {}));
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function weekdayShort(d) {
    return WEEK_SHORT[lang][d.getDay()];
  }

  // 表头 / 迷你条上的日期
  function fmtDay(d) {
    if (lang === 'en') return `${weekdayShort(d)}, ${MONTHS_EN[d.getMonth()]} ${d.getDate()}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdayShort(d)}`;
  }

  // 紧凑月日：中文 11-07，英文 Nov 7
  function fmtMonthDay(d) {
    if (lang === 'en') return `${MONTHS_EN[d.getMonth()]} ${d.getDate()}`;
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function fmtDue(task) {
    if (!task || !task.due) return '';
    const d = new Date(task.due);
    const md = fmtMonthDay(d);
    if (!task.hasTime) return t('due.allDay', { md });
    return t('due.withTime', { md, time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
  }

  function fmtStart(task) {
    if (!task || !task.startAt) return '';
    return fmtMonthDay(new Date(task.startAt));
  }

  // 相对时间：已逾期 5 分 / 还有 2 小时 30 分 / 3 d left
  function relText(due, now) {
    const ms = +due - +now;
    if (ms < 0) {
      const mins = Math.round(-ms / 60000);
      if (mins < 1) return t('rel.justOver');
      if (mins < 60) return tCount('rel.overMin', mins);
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return tCount('rel.overHour', hrs);
      return tCount('rel.overDay', Math.floor(hrs / 24));
    }
    const mins = Math.round(ms / 60000);
    if (mins <= 1) return t('rel.dueNow');
    if (mins < 60) return tCount('rel.leftMin', mins);
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) {
      const m = mins % 60;
      return m ? t('rel.leftHourMin', { h: hrs, m }) : tCount('rel.leftHour', hrs);
    }
    return tCount('rel.leftDay', Math.round(ms / 86400000));
  }

  function groupLabel(key) {
    return t('group.' + key);
  }

  // 顶部提醒条里的任务标题：按语言给不同截断长度（CSS 还有兜底省略号）
  function clipTitle(s) {
    const limit = lang === 'en' ? 18 : 10;
    const str = String(s == null ? '' : s);
    return str.length > limit ? str.slice(0, limit) + '…' : str;
  }

  // 把静态文案刷到 DOM 上；data-i18n=文本，data-i18n-title=title，data-i18n-ph=placeholder
  function applyStatic(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', htmlLang());
    }
  }

  return {
    LANGS,
    DICT,
    setLang,
    getLang,
    htmlLang,
    t,
    tCount,
    weekdayShort,
    fmtDay,
    fmtMonthDay,
    fmtDue,
    fmtStart,
    relText,
    groupLabel,
    clipTitle,
    applyStatic,
  };
});
