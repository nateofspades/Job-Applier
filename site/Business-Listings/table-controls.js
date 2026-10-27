'use strict';
(() => {
  const wrap = document.getElementById('table-wrap');
  const table = wrap.querySelector('table');
  const topScroll = document.getElementById('table-top-scroll');
  const stickyHead = document.getElementById('sticky-head');
  table.tHead.classList.add('visually-hidden-header');
  const sourceHeaders = [...table.querySelectorAll('thead th')];
  sourceHeaders.forEach(header => { header.dataset.column ||= header.textContent.trim(); });
  const columnLabels = { company_name: 'company', ats_provider: 'ats' };
  const tableRows = [...table.querySelectorAll('tr')];
  for (const row of tableRows) [...row.cells].forEach((cell, index) => {
    cell.dataset.column = sourceHeaders[index].dataset.column;
  });
  const defaultColumns = ['company_name', 'career_page_url', 'ats_provider', 'company_description', 'industries', 'city', 'country', 'date_added_to_dataset', 'business_id'];
  const storageKey = 'business-listings-column-order-v1';
  let columns = [...defaultColumns];
  let draggedColumn = null;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved) && saved.length === defaultColumns.length &&
        new Set(saved).size === saved.length && saved.every(column => defaultColumns.includes(column))) {
      columns = saved;
    }
  } catch { /* Keep the default order when storage is unavailable or malformed. */ }

  function applyOrder() {
    for (const row of tableRows) {
      const cells = new Map([...row.cells].map(cell => [cell.dataset.column, cell]));
      row.append(...columns.map(column => cells.get(column)));
    }
    stickyHead.replaceChildren(...columns.map(column => {
      const visibleHeader = document.createElement('div');
      visibleHeader.dataset.column = column;
      visibleHeader.textContent = columnLabels[column] || column;
      if (column === 'date_added_to_dataset') visibleHeader.classList.add('date-added-to-dataset');
      visibleHeader.draggable = true;
      visibleHeader.title = 'Drag to change displayed column order';
      return visibleHeader;
    }));
    resize();
  }
  stickyHead.addEventListener('dragstart', event => {
    const header = event.target.closest('[data-column]');
    if (!header) return;
    draggedColumn = header.dataset.column;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedColumn);
    header.classList.add('dragging');
  });
  function clearDrag() {
    draggedColumn = null;
    stickyHead.querySelectorAll('.dragging,.drop-target').forEach(header => header.classList.remove('dragging', 'drop-target'));
  }
  stickyHead.addEventListener('dragend', clearDrag);
  stickyHead.addEventListener('dragover', event => {
    const header = event.target.closest('[data-column]');
    if (!header || !draggedColumn) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    stickyHead.querySelectorAll('.drop-target').forEach(target => target.classList.remove('drop-target'));
    header.classList.add('drop-target');
  });
  stickyHead.addEventListener('drop', event => {
    const header = event.target.closest('[data-column]');
    if (!header || !draggedColumn) return;
    event.preventDefault();
    const from = columns.indexOf(draggedColumn), to = columns.indexOf(header.dataset.column);
    if (from >= 0 && to >= 0 && from !== to) {
      columns.splice(from, 1);
      columns.splice(to, 0, draggedColumn);
      try { localStorage.setItem(storageKey, JSON.stringify(columns)); } catch { /* Reordering still works for this visit. */ }
      applyOrder();
    }
    clearDrag();
  });
  document.getElementById('column-order-reset').addEventListener('click', () => {
    columns = [...defaultColumns];
    try { localStorage.removeItem(storageKey); } catch { /* Reset still works for this visit. */ }
    clearDrag();
    applyOrder();
  });

  function syncPosition() {
    stickyHead.style.transform = `translateX(${-wrap.scrollLeft}px)`;
  }
  function resize() {
    const sourceCells = table.querySelector('tbody tr:not([hidden])')?.cells;
    if (sourceCells) [...stickyHead.children].forEach((header, index) => {
      header.style.width = `${sourceCells[index].getBoundingClientRect().width}px`;
    });
    topScroll.style.width = `${wrap.clientWidth}px`;
    topScroll.firstElementChild.style.width = `${wrap.scrollWidth}px`;
    topScroll.scrollLeft = wrap.scrollLeft;
    syncPosition();
  }
  topScroll.addEventListener('scroll', () => {
    if (wrap.scrollLeft !== topScroll.scrollLeft) wrap.scrollLeft = topScroll.scrollLeft;
  }, { passive: true });
  wrap.addEventListener('scroll', () => {
    if (topScroll.scrollLeft !== wrap.scrollLeft) topScroll.scrollLeft = wrap.scrollLeft;
    syncPosition();
  }, { passive: true });
  const observer = new ResizeObserver(resize);
  observer.observe(wrap);
  observer.observe(table);
  const filterObserver = new MutationObserver(() => requestAnimationFrame(resize));
  filterObserver.observe(table.tBodies[0], { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  applyOrder();
})();
