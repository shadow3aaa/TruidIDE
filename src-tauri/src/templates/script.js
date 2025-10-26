// 简单的计数器示例
let count = 0;

// 获取 DOM 元素
const btn = document.getElementById('clickBtn');
const counterDisplay = document.getElementById('counter');

// 添加点击事件
btn.addEventListener('click', () => {
  count++;
  counterDisplay.textContent = `点击次数: ${count}`;
  
  // 添加点击动画效果
  btn.style.transform = 'scale(0.95)';
  setTimeout(() => {
    btn.style.transform = 'scale(1)';
  }, 100);
});

// 页面加载完成提示
console.log('TruidIDE Web 项目已加载！');
console.log('开始你的开发之旅吧 🚀');
