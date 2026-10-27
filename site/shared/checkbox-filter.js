(function (root) {
  'use strict';

  function create(container, config) {
    const doc = container.ownerDocument;
    function element(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    const details = element('details', 'checkbox-filter');
    const summary = element('summary', 'filter-summary');
    summary.setAttribute('aria-label', config.label);
    const selection = element('span', 'filter-selection');
    summary.append(selection);
    const panel = element('div', 'filter-panel');
    const search = element('input', 'filter-option-search');
    search.type = 'search';
    search.setAttribute('aria-label', `Search ${config.label} options`);
    const actions = element('div', 'filter-actions');
    const selectAll = element('button', '', 'Select all');
    const clearAll = element('button', '', 'Clear all');
    selectAll.type = clearAll.type = 'button';
    actions.append(selectAll, clearAll);
    const list = element('div', 'filter-options');
    const entries = config.options.map(option => {
      const label = element('label', 'filter-option');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.value = option.value;
      checkbox.checked = !Array.isArray(config.selected) || config.selected.includes(option.value);
      label.append(checkbox, element('span', '', option.label));
      list.append(label);
      return { label, checkbox };
    });
    function values() {
      return entries.filter(entry => entry.checkbox.checked).map(entry => entry.checkbox.value);
    }
    function updateSummary() {
      selection.textContent = `${values().length} of ${entries.length} selected`;
    }
    function notify() {
      updateSummary();
      if (typeof config.onChange === 'function') config.onChange(values());
    }
    function setValues(selected) {
      const chosen = new Set(selected);
      entries.forEach(entry => { entry.checkbox.checked = chosen.has(entry.checkbox.value); });
      notify();
    }
    list.addEventListener('change', notify);
    selectAll.addEventListener('click', () => setValues(entries.map(entry => entry.checkbox.value)));
    clearAll.addEventListener('click', () => setValues([]));
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase();
      entries.forEach(entry => {
        entry.label.hidden = !entry.label.textContent.toLocaleLowerCase().includes(query);
      });
    });
    function reset() {
      search.value = '';
      entries.forEach(entry => { entry.label.hidden = false; });
      setValues(defaultValues);
    }
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape' && details.open) {
        event.preventDefault();
        details.open = false;
        summary.focus();
      }
    });
    doc.addEventListener('click', event => {
      if (details.open && !details.contains(event.target)) details.open = false;
    });
    const defaultValues = values();
    updateSummary();
    panel.append(search, actions, list);
    details.append(summary, panel);
    container.append(details);
    return { values, reset, setValues };
  }

  root.CheckboxFilter = { create };
})(typeof window !== 'undefined' ? window : globalThis);
