# Web 项目模板

这是 TruidIDE 的默认 Web 项目模板，包含以下文件：

## 文件说明

- **index.html** - 主页面文件，包含页面结构
- **style.css** - 样式文件，定义页面外观
- **script.js** - JavaScript 脚本，实现交互功能
- **server.py** - Python 开发服务器，用于本地预览

## 快速开始

### 方法 1: 使用 Python 服务器（推荐）

```bash
# 确保已安装 Python 3
python server.py

# 或者使用 python3
python3 server.py
```

服务器将自动：

- 查找可用端口（默认从 8000 开始）
- 在浏览器中打开项目
- 提供实时预览

### 方法 2: 使用其他服务器

```bash
# 使用 Node.js http-server
npx http-server -p 8000

# 使用 PHP 内置服务器
php -S localhost:8000

# 使用 Python 标准库
python -m http.server 8000
```

## 项目结构

```text
你的项目/
├── index.html      # 入口页面
├── style.css       # 样式表
├── script.js       # JavaScript 逻辑
└── server.py       # 开发服务器
```

## 开发建议

1. **编辑 HTML** - 修改 `index.html` 来调整页面结构
2. **添加样式** - 在 `style.css` 中自定义外观
3. **编写逻辑** - 在 `script.js` 中实现交互功能
4. **添加资源** - 创建 `assets/` 或 `images/` 目录存放静态资源

## 进阶使用

### 集成前端框架

你可以在此基础上集成现代前端框架：

- **React**: `npx create-react-app .`
- **Vue**: `npm init vue@latest`
- **Svelte**: `npm create vite@latest`

### 使用构建工具

- **Vite**: 快速的现代构建工具
- **Webpack**: 功能强大的模块打包器
- **Parcel**: 零配置打包工具

## 注意事项

- `server.py` 仅用于开发，生产环境请使用专业的 Web 服务器
- 修改文件后刷新浏览器即可看到效果
- 支持所有现代浏览器

---

愉快地开发吧！🚀
