// 创始用户价预约入口。两页共用（引导页、设置页）。
// url 留空时整块不显示：还没有预约表单就不要给用户一个点不开的按钮。
const FOUNDING = {
  url: '',                 // 预约表单地址（Google 表单等），填好后入口才会出现
  price: '$2.99',          // 创始价（每月）
  later: '$4.99',          // 恢复后的价格（每月）
  until: '2027 年 1 月',    // 创始价截止时间
};
function renderFounding(box) {
  if (!box || !FOUNDING.url) return;
  const h = document.createElement('h3'); h.textContent = '创始用户价';
  const p = document.createElement('p');
  p.textContent = `DIC 现在免费使用。付费版上线后创始用户 ${FOUNDING.price}/月，${FOUNDING.until}起恢复 ${FOUNDING.later}/月。现在预约即可锁定创始价。`;
  const a = document.createElement('a'); a.className = 'btn ghost'; a.href = FOUNDING.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '预约创始价';
  box.replaceChildren(h, p, a); box.hidden = false;
}
document.addEventListener('DOMContentLoaded', () => renderFounding(document.getElementById('founding')));
