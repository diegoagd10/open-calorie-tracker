(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    view: 'log',
    date: '29',
    nutrientPage: 0,
    activeLayer: null,
    previousFocus: null,
    selectedWater: 8,
    editingWater: null,
    unit: 'us',
    selectedFood: null,
    editingFoodEntry: null,
    foodLogged: false,
    waterTotal: 40,
    toastTimer: null
  };

  const overlay = $('#overlay');
  const app = $('#app');
  const skipLink = $('.skip-link');
  const toast = $('#toast');
  const viewTitle = $('#view-title');
  const views = $$('[data-view]');
  const navButtons = $$('[data-nav]');
  const layers = $$('.bottom-sheet, .dialog-panel');

  const foodFixtures = [
    { id: 'yogurt', name: 'Plain nonfat Greek yogurt', type: 'Branded', detail: 'Example Dairy Co. · 170 g container', calories: 100, protein: 18, carbs: 6, fat: 0 },
    { id: 'bread', name: 'Bread, whole-wheat, commercially prepared', type: 'Foundation', detail: '1 slice (32 g)', calories: 82, protein: 4, carbs: 14, fat: 1 },
    { id: 'chicken', name: 'Chicken breast, roasted, skinless', type: 'Survey / FNDDS', detail: '100 g', calories: 165, protein: 31, carbs: 0, fat: 4 },
    { id: 'unsafe', name: 'Prepared food with unsupported serving text', type: 'Branded', detail: 'Measurement unavailable · cannot log safely', unsafe: true }
  ];

  const dayData = {
    '29': { label: 'Saturday, August 29', calories: 1420, remaining: 630, mode: 'populated' },
    '28': { label: 'Friday, August 28', calories: 1860, remaining: 190, mode: 'populated' },
    '27': { label: 'Thursday, August 27', calories: 0, remaining: 2050, mode: 'empty' },
    '26': { label: 'Wednesday, August 26', calories: 0, remaining: 2050, mode: 'empty' },
    '25': { label: 'Tuesday, August 25', calories: 0, remaining: 2050, mode: 'empty' },
    '24': { label: 'Monday, August 24', calories: 0, remaining: 2050, mode: 'empty' },
    '30': { label: 'Sunday, August 30', calories: 0, remaining: 2050, mode: 'future' }
  };

  function waterDisplay(ounces) {
    return state.unit === 'metric'
      ? { value: Math.round(ounces * 29.5735), unit: 'ml' }
      : { value: Math.round(ounces * 10) / 10, unit: 'fl oz' };
  }

  function updateDailyCalories(delta) {
    const data = dayData[state.date];
    if (!data) return;
    data.calories = Math.max(0, data.calories + delta);
    data.remaining = Math.max(0, 2050 - data.calories);
    const value = data.calories.toLocaleString('en-US');
    $('#calorie-value').textContent = value;
    $('#calorie-remaining').textContent = `${data.remaining.toLocaleString('en-US')} kcal remaining`;
    const progress = Math.min(100, data.calories / 2050 * 100);
    $('.linear-progress span').style.setProperty('--progress', `${progress}%`);
    $('.linear-progress').setAttribute('aria-valuenow', String(data.calories));
    const context = $('.context-metric:not(.water-context) strong');
    if (context) context.innerHTML = `${value} <small>/ 2,050 kcal</small>`;
  }

  function refreshWaterUI() {
    const total = waterDisplay(state.waterTotal);
    $('#water-total').innerHTML = `${total.value} <small>/ ${waterDisplay(80).value} ${total.unit}</small>`;
    $('#water-equivalent').textContent = `${(state.waterTotal / 8).toFixed(state.waterTotal % 8 ? 1 : 0)} equivalent glasses · 8 fl oz / 237 ml`;
    const overviewProgress = $('.water-overview-progress');
    if (overviewProgress) {
      $('span', overviewProgress).style.setProperty('--progress', `${Math.min(100, state.waterTotal / 80 * 100)}%`);
      overviewProgress.setAttribute('aria-valuenow', String(state.waterTotal));
      overviewProgress.setAttribute('aria-valuetext', `${total.value} of ${waterDisplay(80).value} ${total.unit}`);
    }
    const context = $('.water-context strong');
    if (context) context.innerHTML = `${total.value} <small>/ ${waterDisplay(80).value} ${total.unit}</small>`;
    const contextProgress = $('.water-context i span');
    if (contextProgress) contextProgress.style.setProperty('--progress', `${Math.min(100, state.waterTotal / 80 * 100)}%`);
    $$('.water-event').forEach((event) => {
      const amount = waterDisplay(Number(event.dataset.amount));
      $('.event-value', event).innerHTML = `${amount.value} <small>${amount.unit}</small>`;
    });
    $$('.preset-button[data-water]:not([data-water="custom"])').forEach((button) => {
      const amount = waterDisplay(Number(button.dataset.water));
      $('strong', button).textContent = amount.value;
      $('span', button).textContent = amount.unit;
    });
    $('#custom-water-unit').textContent = state.unit === 'metric' ? 'ml' : 'fl oz';
    const waterGoal = $('[name="waterGoal"]');
    if (waterGoal) {
      waterGoal.value = String(waterDisplay(80).value);
      waterGoal.nextElementSibling.textContent = total.unit;
    }
  }

  function selectWaterPreset(button) {
    $$('.preset-button').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
  }

  function createWaterEvent(amount) {
    const button = document.createElement('button');
    button.className = 'timeline-event water-event';
    button.dataset.action = 'edit-water';
    button.dataset.amount = String(amount);
    button.innerHTML = '<time datetime="2026-08-29T15:20">3:20 PM</time><span class="timeline-marker water-marker"><svg><use href="#icon-water"/></svg></span><span class="event-content"><strong>Water</strong><small>Plain water</small></span><span class="event-value"></span><svg class="chevron"><use href="#icon-chevron"/></svg>';
    $('.timeline-add-water').before(button);
    refreshWaterUI();
    return button;
  }

  function createFoodEvent(food, calories, measurement, quantity) {
    const button = document.createElement('button');
    button.className = 'timeline-event';
    button.dataset.action = 'edit-food';
    button.dataset.entry = food.id;
    button.dataset.calories = String(calories);
    button.dataset.baseCalories = String(food.calories);
    button.dataset.baseProtein = String(food.protein);
    button.dataset.baseCarbs = String(food.carbs);
    button.dataset.baseFat = String(food.fat);
    button.dataset.baseMeasurement = '170';
    button.dataset.measurement = String(measurement);
    button.dataset.quantity = String(quantity);
    button.innerHTML = `<time datetime="2026-08-29T15:15">3:15 PM</time><span class="timeline-marker food-marker"><svg><use href="#icon-utensils"/></svg></span><span class="event-content"><strong>${food.name}</strong><small>USDA FoodData Central · ${food.type}</small></span><span class="event-value">${calories} <small>kcal</small></span><svg class="chevron"><use href="#icon-chevron"/></svg>`;
    $('.timeline-add-water').before(button);
    return button;
  }

  function setView(name, focus = true) {
    state.view = name;
    views.forEach((view) => {
      const active = view.dataset.view === name;
      view.hidden = !active;
      view.classList.toggle('is-active', active);
    });
    navButtons.forEach((button) => {
      const active = button.dataset.nav === name;
      button.classList.toggle('is-active', active);
      if (button.closest('.bottom-nav')) button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    const title = name === 'log' ? 'Today' : name === 'history' ? 'History' : 'Settings';
    viewTitle.textContent = title;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (focus) $('#main-content').focus({ preventScroll: true });
  }

  function setDate(date) {
    const data = dayData[date];
    if (!data) return;
    state.date = date;
    $$('.date-button').forEach((button) => {
      const selected = button.dataset.date === date;
      button.classList.toggle('is-selected', selected);
      if (selected) button.setAttribute('aria-current', 'date'); else button.removeAttribute('aria-current');
    });
    $('#selected-day-label').textContent = data.label;
    const contextDay = $('.context-head strong');
    if (contextDay) contextDay.textContent = data.label.replace(',', ' ·').replace(', 2026', '');
    const value = data.calories.toLocaleString('en-US');
    $('#calorie-value').textContent = value;
    $('#calorie-remaining').textContent = `${data.remaining.toLocaleString('en-US')} kcal remaining`;
    const progress = Math.min(100, data.calories / 2050 * 100);
    $('.linear-progress span').style.setProperty('--progress', `${progress}%`);
    $('.linear-progress').setAttribute('aria-valuenow', String(data.calories));
    const timeline = $('#timeline');
    const empty = $('#empty-day');
    const future = $('#future-day');
    timeline.hidden = data.mode !== 'populated';
    empty.hidden = data.mode !== 'empty';
    future.hidden = data.mode !== 'future';
    $$('.water-overview, .provider-attribution').forEach((el) => { el.hidden = data.mode === 'future'; });
    if (data.mode === 'future') showToast('Future dates cannot accept food or water records.', 'alert');
    if (data.mode === 'empty') showToast('Past day selected. New entries will start at 12:00 PM.', 'info');
    setView('log', false);
  }

  function showNutrientPage(page) {
    state.nutrientPage = Number(page);
    $$('.nutrient-page').forEach((panel) => {
      const active = Number(panel.dataset.nutrientPage) === state.nutrientPage;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    $$('.carousel-dot').forEach((dot) => {
      const active = Number(dot.dataset.page) === state.nutrientPage;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-pressed', String(active));
    });
  }

  function openLayer(id) {
    const layer = document.getElementById(id);
    if (!layer) return;
    if (state.activeLayer) closeLayer(false);
    state.previousFocus = document.activeElement;
    state.activeLayer = layer;
    overlay.hidden = false;
    layer.hidden = false;
    app.inert = true;
    app.setAttribute('aria-hidden', 'true');
    skipLink.inert = true;
    skipLink.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const target = $('input:not([type="hidden"]), button:not([disabled]), select', layer);
      target?.focus();
    });
  }

  function closeLayer(restore = true) {
    if (!state.activeLayer) return;
    state.activeLayer.hidden = true;
    overlay.hidden = true;
    app.inert = false;
    app.removeAttribute('aria-hidden');
    skipLink.inert = false;
    skipLink.removeAttribute('aria-hidden');
    document.body.style.overflow = '';
    const previous = state.previousFocus;
    state.activeLayer = null;
    if (restore && previous instanceof HTMLElement) previous.focus();
  }

  function showToast(message, kind = 'success') {
    clearTimeout(state.toastTimer);
    const icon = $('use', toast);
    icon.setAttribute('href', kind === 'alert' ? '#icon-alert' : kind === 'info' ? '#icon-info' : '#icon-check');
    $('span', toast).textContent = message;
    toast.hidden = false;
    state.toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
  }

  function setSearchState(kind, title, body) {
    const searchState = $('#search-state');
    searchState.hidden = false;
    searchState.className = `search-state ${kind ? `is-${kind}` : ''}`;
    $('use', searchState).setAttribute('href', kind === 'error' || kind === 'warning' ? '#icon-alert' : '#icon-search');
    $('h3', searchState).textContent = title;
    $('p', searchState).textContent = body;
    $('#search-results').hidden = true;
  }

  function renderResults(results) {
    const container = $('#search-results');
    container.innerHTML = '';
    results.forEach((food) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `result-button${food.unsafe ? ' is-unsafe' : ''}`;
      button.disabled = Boolean(food.unsafe);
      button.dataset.foodId = food.id;
      button.innerHTML = `<span><span class="catalog-type">${food.type}</span><strong>${food.name}</strong><small>${food.detail}</small></span><small>${food.unsafe ? 'Hidden in production' : 'Select'}</small><svg class="chevron"><use href="#icon-chevron"/></svg>`;
      container.append(button);
    });
    $('#search-state').hidden = true;
    container.hidden = false;
  }

  function runSearch(query) {
    const value = query.trim();
    $('#search-error').textContent = '';
    if (value.length < 2) {
      $('#search-error').textContent = 'Enter at least 2 characters before searching.';
      setSearchState('warning', 'Search not sent', 'A longer query prevents accidental provider requests.');
      return;
    }
    setSearchState('loading', 'Searching USDA FoodData Central', 'One deliberate provider request is in progress…');
    setTimeout(() => {
      const normalized = value.toLowerCase();
      if (normalized.includes('none') || normalized.includes('zzz')) {
        setSearchState('', 'No foods found', 'Try a broader product or ingredient name. Your Food Log was not changed.');
      } else if (normalized.includes('rate')) {
        setSearchState('warning', 'USDA rate limit reached', 'Wait a moment and search again. Existing Food Entries remain available.');
      } else if (normalized.includes('offline') || normalized.includes('unavailable')) {
        setSearchState('error', 'USDA is unavailable', 'Search cannot answer right now. Try again later; your saved Nutrition Snapshots are unaffected.');
      } else {
        const match = normalized.includes('bread') ? [foodFixtures[1], foodFixtures[2], foodFixtures[3]] : foodFixtures;
        renderResults(match);
      }
    }, 580);
  }

  function selectFood(id) {
    const food = foodFixtures.find((item) => item.id === id);
    if (!food || food.unsafe) return;
    state.selectedFood = food;
    $('#selected-food-type').textContent = food.type;
    $('#selected-food-name').textContent = food.name;
    $('#food-search-stage').hidden = true;
    $('#food-detail-stage').hidden = false;
    $('#food-quantity').value = '1';
    updateFoodPreview();
  }

  function updateFoodPreview() {
    const food = state.selectedFood || foodFixtures[0];
    const quantity = Math.max(0, Number($('#food-quantity').value) || 0);
    const measurement = Number($('#food-measurement').value) || 170;
    const multiplier = quantity * measurement / 170;
    $('#preview-calories').textContent = `${Math.round(food.calories * multiplier)} kcal`;
    $('#preview-protein').textContent = `${(food.protein * multiplier).toFixed(1).replace('.0', '')} g`;
    $('#preview-carbs').textContent = `${(food.carbs * multiplier).toFixed(1).replace('.0', '')} g`;
    $('#preview-fat').textContent = `${(food.fat * multiplier).toFixed(1).replace('.0', '')} g`;
  }

  function resetFoodDialog() {
    $('#food-search-stage').hidden = false;
    $('#food-detail-stage').hidden = true;
    $('#food-query').value = '';
    $('#search-error').textContent = '';
    setSearchState('', 'Find a food', 'Results can include Branded, Survey/FNDDS, and Foundation foods.');
  }

  function openFoodSearch(prefill = '') {
    if (dayData[state.date].mode === 'future') {
      showToast('Choose today or a past date before adding food.', 'alert');
      return;
    }
    resetFoodDialog();
    openLayer('food-dialog');
    if (prefill) {
      $('#food-query').value = prefill;
      runSearch(prefill);
    }
  }

  function openWater(eventToEdit = null) {
    if (dayData[state.date].mode === 'future') {
      showToast('Choose today or a past date before adding water.', 'alert');
      return;
    }
    state.editingWater = eventToEdit;
    const initialAmount = eventToEdit ? Number(eventToEdit.dataset.amount) : 8;
    $('#water-sheet-title').textContent = eventToEdit ? 'Edit Water Event' : 'Add Water';
    state.selectedWater = initialAmount;
    const matchingPreset = $(`.preset-button[data-water="${initialAmount}"]`) || $('.preset-button[data-water="custom"]');
    selectWaterPreset(matchingPreset);
    const custom = matchingPreset.dataset.water === 'custom';
    $('#custom-water').hidden = !custom;
    if (custom) $('#custom-water-value').value = String(waterDisplay(initialAmount).value);
    $('#water-delete').hidden = !eventToEdit;
    $('#delete-water-confirm').hidden = true;
    const amount = waterDisplay(initialAmount);
    $('[data-action="save-water"]').textContent = `${eventToEdit ? 'Save' : 'Add'} ${amount.value} ${amount.unit}`;
    openLayer('water-sheet');
  }

  function openEditFood(entryButton) {
    state.editingFoodEntry = entryButton;
    const name = $('.event-content strong', entryButton).textContent;
    $('#edit-food-name').textContent = name;
    $('#edit-food-quantity').value = entryButton.dataset.quantity || '1';
    $('[name="editMeasurement"]').value = entryButton.dataset.measurement || entryButton.dataset.baseMeasurement || '170';
    $('#edit-calories').textContent = `${Number(entryButton.dataset.calories)} kcal`;
    const multiplier = Number(entryButton.dataset.quantity || 1) * Number(entryButton.dataset.measurement || 170) / Number(entryButton.dataset.baseMeasurement || 170);
    $('#edit-protein').textContent = `${Math.round(Number(entryButton.dataset.baseProtein || 0) * multiplier * 10) / 10} g`;
    $('#edit-carbs').textContent = `${Math.round(Number(entryButton.dataset.baseCarbs || 0) * multiplier * 10) / 10} g`;
    $('#edit-fat').textContent = `${Math.round(Number(entryButton.dataset.baseFat || 0) * multiplier * 10) / 10} g`;
    $('#delete-food-confirm').hidden = true;
    openLayer('edit-food-dialog');
  }

  function openAuth() {
    setAuthTab('signin');
    $('#signin-error').hidden = true;
    openLayer('auth-dialog');
  }

  function setAuthTab(tab) {
    $$('[data-auth-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.authTab === tab)));
    $$('[data-auth-panel]').forEach((panel) => {
      const active = panel.dataset.authPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
  }

  navButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.nav)));

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.matches('.date-button')) setDate(button.dataset.date);
    if (button.matches('.carousel-dot')) showNutrientPage(button.dataset.page);
    if (button.matches('.nutrient-page-shortcut')) showNutrientPage(button.dataset.page);
    if (button.dataset.openDate) setDate(button.dataset.openDate);
    if (button.dataset.authTab) setAuthTab(button.dataset.authTab);
    if (button.dataset.foodId) selectFood(button.dataset.foodId);

    if (button.dataset.query) {
      $('#food-query').value = button.dataset.query;
      runSearch(button.dataset.query);
    }

    if (button.dataset.water) {
      selectWaterPreset(button);
      const custom = button.dataset.water === 'custom';
      $('#custom-water').hidden = !custom;
      const entered = Number($('#custom-water-value').value);
      state.selectedWater = custom ? (state.unit === 'metric' ? entered / 29.5735 : entered) : Number(button.dataset.water);
      const amount = waterDisplay(state.selectedWater);
      $('[data-action="save-water"]').textContent = custom ? `${state.editingWater ? 'Save' : 'Add'} exact amount` : `${state.editingWater ? 'Save' : 'Add'} ${amount.value} ${amount.unit}`;
      if (custom) $('#custom-water-value').focus();
    }

    const action = button.dataset.action;
    if (!action) return;
    if (action === 'close-layer') closeLayer();
    if (action === 'open-food-search') openFoodSearch();
    if (action === 'open-water') openWater();
    if (action === 'edit-food') openEditFood(button);
    if (action === 'edit-water') openWater(button);
    if (action === 'previous-week') setView('history');
    if (action === 'previous-month') showToast('July 2026 is represented as an earlier empty month in this mock.', 'info');
    if (action === 'open-auth') openAuth();
    if (action === 'nutrient-detail') {
      $('#info-title').textContent = button.dataset.nutrient === 'Fiber' ? 'Fiber is incomplete' : `${button.dataset.nutrient} progress`;
      openLayer('info-dialog');
    }
    if (action === 'back-to-results') {
      $('#food-search-stage').hidden = false;
      $('#food-detail-stage').hidden = true;
    }
    if (action === 'log-food') {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Adding once…';
      setTimeout(() => {
        state.foodLogged = true;
        const quantity = Math.max(0, Number($('#food-quantity').value) || 0);
        const measurement = Number($('#food-measurement').value) || 170;
        const calories = Math.round((state.selectedFood?.calories || 0) * quantity * measurement / 170);
        createFoodEvent(state.selectedFood || foodFixtures[0], calories, measurement, quantity);
        updateDailyCalories(calories);
        button.disabled = false;
        button.textContent = 'Add to Food Log';
        closeLayer();
        showToast(`${state.selectedFood?.name || 'Food'} added once to the Food Log.`);
      }, 650);
    }
    if (action === 'save-water') {
      const amount = state.selectedWater;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 500) {
        $('#custom-water-error').textContent = state.unit === 'metric' ? 'Enter an amount greater than 0 and no more than 14,787 ml.' : 'Enter an amount greater than 0 and no more than 500 fl oz.';
        $('#custom-water-value').setAttribute('aria-invalid', 'true');
        return;
      }
      if (state.editingWater) {
        const previousAmount = Number(state.editingWater.dataset.amount);
        state.waterTotal = Math.round((state.waterTotal - previousAmount + amount) * 10) / 10;
        state.editingWater.dataset.amount = String(amount);
      } else {
        state.waterTotal = Math.round((state.waterTotal + amount) * 10) / 10;
        createWaterEvent(amount);
      }
      refreshWaterUI();
      $('#water-sheet-title').textContent = 'Add Water';
      closeLayer();
      const saved = waterDisplay(amount);
      showToast(`${saved.value} ${saved.unit} water saved.`);
    }
    if (action === 'confirm-delete-food') $('#delete-food-confirm').hidden = false;
    if (action === 'cancel-delete-food') $('#delete-food-confirm').hidden = true;
    if (action === 'delete-food') {
      const calories = Number(state.editingFoodEntry?.dataset.calories || 0);
      state.editingFoodEntry?.remove();
      updateDailyCalories(-calories);
      closeLayer();
      showToast('Food Entry deleted. Daily totals updated.');
    }
    if (action === 'confirm-delete-water') $('#delete-water-confirm').hidden = false;
    if (action === 'cancel-delete-water') $('#delete-water-confirm').hidden = true;
    if (action === 'delete-water' && state.editingWater) {
      const amount = Number(state.editingWater.dataset.amount);
      state.waterTotal = Math.max(0, Math.round((state.waterTotal - amount) * 10) / 10);
      state.editingWater.remove();
      state.editingWater = null;
      refreshWaterUI();
      closeLayer();
      showToast('Water Event deleted. Daily total updated.');
    }
    if (action === 'reset-goals') showToast('Mock goal values restored.', 'info');
    if (action === 'logout') {
      openAuth();
      showToast('Current session revoked. Other device sessions remain active.', 'info');
    }
  });

  $('#food-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch($('#food-query').value);
  });

  $('#food-quantity').addEventListener('input', updateFoodPreview);
  $('#food-measurement').addEventListener('change', updateFoodPreview);
  $('#custom-water-value').addEventListener('input', (event) => {
    const entered = Number(event.target.value);
    state.selectedWater = state.unit === 'metric' ? entered / 29.5735 : entered;
    $('#custom-water-error').textContent = '';
    event.target.removeAttribute('aria-invalid');
    $('[data-action="save-water"]').textContent = Number.isFinite(entered) ? `${state.editingWater ? 'Save' : 'Add'} ${entered} ${state.unit === 'metric' ? 'ml' : 'fl oz'}` : `${state.editingWater ? 'Save' : 'Add'} exact amount`;
  });

  function updateEditedFoodPreview() {
    const baseCalories = Number(state.editingFoodEntry?.dataset.baseCalories || 0);
    const baseProtein = Number(state.editingFoodEntry?.dataset.baseProtein || 0);
    const baseCarbs = Number(state.editingFoodEntry?.dataset.baseCarbs || 0);
    const baseFat = Number(state.editingFoodEntry?.dataset.baseFat || 0);
    const baseMeasurement = Number(state.editingFoodEntry?.dataset.baseMeasurement || 170);
    const quantity = Math.max(0, Number($('#edit-food-quantity').value) || 0);
    const measurement = Number($('[name="editMeasurement"]').value);
    const multiplier = quantity * measurement / baseMeasurement;
    $('#edit-calories').textContent = `${Math.round(baseCalories * multiplier)} kcal`;
    $('#edit-protein').textContent = `${Math.round(baseProtein * multiplier * 10) / 10} g`;
    $('#edit-carbs').textContent = `${Math.round(baseCarbs * multiplier * 10) / 10} g`;
    $('#edit-fat').textContent = `${Math.round(baseFat * multiplier * 10) / 10} g`;
  }

  $('#edit-food-quantity').addEventListener('input', updateEditedFoodPreview);
  $('[name="editMeasurement"]').addEventListener('change', updateEditedFoodPreview);

  $('#edit-food-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const previousCalories = Number(state.editingFoodEntry?.dataset.calories || 0);
    const nextCalories = Number.parseInt($('#edit-calories').textContent, 10) || 0;
    if (state.editingFoodEntry) {
      state.editingFoodEntry.dataset.calories = String(nextCalories);
      state.editingFoodEntry.dataset.measurement = $('[name="editMeasurement"]').value;
      state.editingFoodEntry.dataset.quantity = $('#edit-food-quantity').value;
      $('.event-value', state.editingFoodEntry).innerHTML = `${nextCalories} <small>kcal</small>`;
    }
    updateDailyCalories(nextCalories - previousCalories);
    closeLayer();
    showToast('Food Entry updated. Other entries were not changed.');
  });

  $$('input[name="units"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
      state.unit = event.target.value;
      refreshWaterUI();
      showToast(state.unit === 'metric' ? 'Metric water values shown in milliliters.' : 'US water values shown in fluid ounces.', 'info');
    });
  });

  $$('input[name="setupUnits"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
      const metric = event.target.value === 'metric';
      const input = $('[name="setupWater"]');
      input.value = metric ? '2366' : '80';
      input.nextElementSibling.textContent = metric ? 'ml' : 'fl oz';
    });
  });

  $('#goal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    showToast('New goal version saved for August 30, 2026.');
  });

  $('#password-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = String(form.get('newPassword') || '');
    if (next.length < 12) {
      showToast('New password must contain at least 12 characters.', 'alert');
      return;
    }
    event.currentTarget.reset();
    showToast('Password changed. Other sessions were revoked.');
  });

  $('#signin-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get('username') || '').trim();
    const password = String(form.get('password') || '');
    if (!username || !password || username.toLowerCase() === 'wrong') {
      $('#signin-error').hidden = false;
      return;
    }
    closeLayer();
    showToast('Signed in. This phone has its own mock session.');
  });

  $('#register-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get('username') || '').trim();
    const password = String(form.get('password') || '');
    const confirmation = String(form.get('confirmPassword') || '');
    const error = $('#register-error');
    error.textContent = '';
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
      error.textContent = 'Use 3–30 ASCII letters, digits, dot, hyphen, or underscore.';
      return;
    }
    if (username.toLowerCase() === 'demo.user') {
      error.textContent = 'That username is already registered. Usernames are compared case-insensitively.';
      return;
    }
    if (password.length < 12 || password.length > 128) {
      error.textContent = 'Password must contain 12–128 characters.';
      return;
    }
    if (password !== confirmation) {
      error.textContent = 'Passwords do not match.';
      return;
    }
    closeLayer(false);
    openLayer('setup-dialog');
  });

  $('#setup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    closeLayer();
    setView('log');
    showToast('Setup complete. Today’s Food Log is ready.');
  });

  $$('[data-demo-state]').forEach((button) => {
    button.addEventListener('click', () => {
      const demo = button.dataset.demoState;
      if (demo === 'empty') setDate('27');
      if (demo === 'future') setDate('30');
      if (demo === 'first-run') openLayer('setup-dialog');
      if (demo.startsWith('search-')) {
        const query = demo === 'search-no-results' ? 'none' : demo === 'search-rate' ? 'rate' : 'unavailable';
        openFoodSearch(query);
      }
    });
  });

  $$('.calendar-day:not(.is-outside):not(.is-future)').forEach((button) => {
    const date = button.textContent.trim();
    button.dataset.openDate = date;
    if (!dayData[date]) {
      const parsed = new Date(Date.UTC(2026, 7, Number(date)));
      dayData[date] = {
        label: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(parsed),
        calories: 0,
        remaining: 2050,
        mode: 'empty'
      };
    }
  });

  overlay.addEventListener('click', () => closeLayer());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.activeLayer) closeLayer();
    if (event.key !== 'Tab' || !state.activeLayer) return;
    const focusable = $$('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]', state.activeLayer).filter((el) => !el.hidden && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  showNutrientPage(0);
  refreshWaterUI();
})();
