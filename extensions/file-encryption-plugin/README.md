# 文件加密插件

## 📁 目录结构

### 🔧 核心代码

- **index.ts** - 插件主代码（AES-256-GCM 加密/解密）
- **index.test.ts** - 单元测试（30+ 测试用例）
- **openclaw.plugin.json** - 插件清单和配置定义

### 📖 用户手册

- **USER-MANUAL.html** - 📚 完整用户手册（HTML 格式，浏览器打开即可查看）

### 🛠️ 工具脚本

- **quick-start.sh** - 快速启动脚本
- **setup.sh** - 交互式安装向导
- **derive-key-from-password.js** - 密码派生密钥工具

### 💡 示例代码

- **demo.ts** - 功能演示（8 个示例场景）
- **example-usage.ts** - 使用示例（5 个实际场景）

## 🚀 快速开始

1. 打开用户手册：[USER-MANUAL.html](./USER-MANUAL.html)
2. 按照"快速开始"章节配置插件
3. 运行测试验证：`pnpm test extensions/file-encryption-plugin/index.test.ts`

## 📚 查看文档

双击打开 **USER-MANUAL.html** 文件，或在浏览器中访问即可查看完整的用户手册！
