# plugins/ —— 只放插件宿主约定，插件源码不在这里

插件本体（目前是「壁纸穿透」）已经拆到独立仓库：
**https://github.com/Heisn1006/desk-note-plugins**

## 为什么

- 主仓库只负责便签本体 + 插件宿主（`renderer/plugin-host.js`、`main.js` 里的加载与管理、设置里的插件页）；
- 插件按标签单独发版，改插件不用动主程序的版本号；
- 安装包里仍然**内置**插件，用户端不需要联网下载。

## 怎么把插件放进仓库 / 打包

```bat
:: 默认按 plugins/lock.json 里的 tag 拉取（需要网络；走代理先 set HTTPS_PROXY=...）
node dev\tools\fetch-plugins.mjs

:: 或者从本地克隆的插件仓库拷（离线 / 正在改插件时）
node dev\tools\fetch-plugins.mjs --from ..\desk-note-plugins
```

拉到之后目录结构是：

```
plugins/
├─ lock.json          要用的插件仓库 + 标签 + 插件 id（入库）
├─ README.md          （入库）
└─ wallpaper/         插件本体（被 .gitignore 忽略，不入库）
   ├─ plugin.json
   └─ index.js
```

`dev\check-all.cmd` 之前会顺带检查插件是否存在；打包（`dist`）前必须先拉一次。

## 插件怎么被加载

宿主扫描 `plugins/<id>/plugin.json`，按 `main` 字段执行 `index.js`，插件调用
`window.deskPluginHost.register({ id, mount, unmount })` 挂载。宿主设置里有开关和卸载（删除插件文件）。
