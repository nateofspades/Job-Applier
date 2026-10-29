(() => {
  const tableWrap = document.getElementById('table-wrap');
  const topScroll = document.getElementById('table-top-scroll');
  const track = topScroll.firstElementChild;
  const table = tableWrap.querySelector('table');
  const stickyTable = document.querySelector('.table-sticky-head table');

  function syncHeaderWidths() {
    const sourceCells = tableWrap.querySelectorAll(table.tBodies[0].rows.length ? 'tbody tr:first-child td' : 'thead th');
    const stickyCells = document.querySelectorAll('#sticky-head th');
    if (sourceCells.length !== stickyCells.length) return;
    sourceCells.forEach((cell, index) => {
      stickyCells[index].style.width = `${cell.getBoundingClientRect().width}px`;
      stickyCells[index].style.minWidth = `${cell.getBoundingClientRect().width}px`;
    });
  }
  function syncStickyHeaderPosition() {
    stickyTable.style.transform = `translateX(${-tableWrap.scrollLeft}px)`;
  }
  function resize() {
    topScroll.style.width = tableWrap.clientWidth + 'px';
    track.style.width = tableWrap.scrollWidth + 'px';
    stickyTable.style.width = tableWrap.scrollWidth + 'px';
    topScroll.scrollLeft = tableWrap.scrollLeft;
    syncHeaderWidths();
    syncStickyHeaderPosition();
  }
  topScroll.addEventListener('scroll', () => {
    if (tableWrap.scrollLeft !== topScroll.scrollLeft) tableWrap.scrollLeft = topScroll.scrollLeft;
  }, { passive: true });
  tableWrap.addEventListener('scroll', () => {
    if (topScroll.scrollLeft !== tableWrap.scrollLeft) topScroll.scrollLeft = tableWrap.scrollLeft;
    syncStickyHeaderPosition();
  }, { passive: true });
  document.addEventListener('job-listings-rendered', () => requestAnimationFrame(resize));
  const observer = new ResizeObserver(resize);
  observer.observe(tableWrap);
  observer.observe(table);
  resize();
})();
