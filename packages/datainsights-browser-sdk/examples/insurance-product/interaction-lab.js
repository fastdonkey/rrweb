(() => {
  const root = document.querySelector('#interaction-lab');
  if (!root || root.dataset.initialized === 'true') return;
  root.dataset.initialized = 'true';

  const STORAGE_KEY = 'datainsights-interaction-lab-v1';
  const defaultState = {
    version: 1,
    selectedTab: 'medical',
    expandedPanels: [],
    selectedSuggestion: null,
    activeSlide: 0,
    toastCount: 0,
    virtualRange: [0, 0],
    selectedVirtualItem: null,
    canvasStrokeCount: 0,
    canvasCompleted: false,
    webglState: 'idle',
    mediaPermissionState: 'not-requested',
  };

  const readState = () => {
    try {
      const candidate = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
      if (candidate?.version === 1) {
        return {
          ...defaultState,
          ...candidate,
          expandedPanels: Array.isArray(candidate.expandedPanels)
            ? candidate.expandedPanels
            : [],
        };
      }
    } catch (_error) {
      // A disabled or corrupted sessionStorage only disables restoration.
    }
    return { ...defaultState, expandedPanels: [] };
  };
  const state = readState();
  const saveState = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_error) {
      document.querySelector('#lab-restore-status').textContent =
        '当前浏览器不可保存实验状态';
    }
  };

  const tabContent = {
    medical: ['医疗', '医疗保障动态内容'],
    claims: ['理赔', '理赔材料与进度动态内容'],
    services: ['服务', '增值服务与咨询动态内容'],
  };
  const renderTabs = () => {
    root.querySelectorAll('[data-lab-tab]').forEach((button) => {
      button.setAttribute(
        'aria-selected',
        String(button.dataset.labTab === state.selectedTab),
      );
    });
    const [label, content] =
      tabContent[state.selectedTab] ?? tabContent.medical;
    document.querySelector('#lab-tab-panel').textContent = content;
    document.querySelector(
      '#lab-tab-status',
    ).textContent = `当前页签：${label}`;
  };
  root.querySelectorAll('[data-lab-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedTab = button.dataset.labTab;
      saveState();
      renderTabs();
    });
  });

  const renderAccordions = () => {
    root.querySelectorAll('[data-lab-accordion]').forEach((button) => {
      const expanded = state.expandedPanels.includes(
        button.dataset.labAccordion,
      );
      button.setAttribute('aria-expanded', String(expanded));
      button.querySelector('span').textContent = expanded ? '－' : '＋';
      button.nextElementSibling.hidden = !expanded;
    });
  };
  root.querySelectorAll('[data-lab-accordion]').forEach((button) => {
    button.addEventListener('click', () => {
      const code = button.dataset.labAccordion;
      state.expandedPanels = state.expandedPanels.includes(code)
        ? state.expandedPanels.filter((candidate) => candidate !== code)
        : [...state.expandedPanels, code];
      saveState();
      renderAccordions();
    });
  });

  const suggestions = [
    '上海市第一人民医院',
    '上海市第六人民医院',
    '北京协和医院',
    '广州医科大学附属医院',
    '阿司匹林肠溶片',
    '软件测试工程师',
  ];
  const search = document.querySelector('#lab-search');
  const results = document.querySelector('#lab-search-results');
  let filteredSuggestions = [];
  let activeSuggestion = -1;
  const selectSuggestion = (value) => {
    state.selectedSuggestion = value;
    document.querySelector(
      '#lab-selected-suggestion',
    ).textContent = `已选择：${value}`;
    search.value = value;
    results.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    saveState();
  };
  const renderSuggestions = () => {
    results.replaceChildren();
    filteredSuggestions.forEach((value, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `lab-suggestion-${index}`;
      button.role = 'option';
      button.textContent = value;
      button.classList.toggle('is-active', index === activeSuggestion);
      button.setAttribute('aria-selected', String(index === activeSuggestion));
      button.addEventListener('click', () => selectSuggestion(value));
      results.append(button);
    });
    if (filteredSuggestions.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'lab-status';
      empty.textContent = '没有匹配结果';
      results.append(empty);
    }
    results.hidden = false;
    search.setAttribute('aria-expanded', 'true');
  };
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    activeSuggestion = -1;
    if (!query) {
      results.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      return;
    }
    filteredSuggestions = suggestions.filter((value) =>
      value.toLowerCase().includes(query),
    );
    renderSuggestions();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      results.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter' && activeSuggestion >= 0) {
      selectSuggestion(filteredSuggestions[activeSuggestion]);
      return;
    }
    if (filteredSuggestions.length === 0) return;
    activeSuggestion =
      event.key === 'ArrowUp'
        ? (activeSuggestion - 1 + filteredSuggestions.length) %
          filteredSuggestions.length
        : (activeSuggestion + 1) % filteredSuggestions.length;
    search.setAttribute(
      'aria-activedescendant',
      `lab-suggestion-${activeSuggestion}`,
    );
    renderSuggestions();
  });

  const slides = [
    '住院医疗',
    '特定药品',
    '重疾津贴',
    '异地转诊',
    '在线问诊',
    '家庭共享',
  ];
  const slideTrack = document.querySelector('#lab-slide-track');
  slides.forEach((label, index) => {
    const card = document.createElement('article');
    const title = document.createElement('strong');
    const copy = document.createElement('span');
    card.className = 'lab-slide-card';
    card.dataset.slideIndex = String(index);
    title.textContent = label;
    copy.textContent = `方案 ${index + 1} 的横向滑动测试内容`;
    card.append(title, copy);
    slideTrack.append(card);
  });
  const renderSlide = (shouldScroll) => {
    state.activeSlide = Math.max(
      0,
      Math.min(slides.length - 1, state.activeSlide),
    );
    document.querySelector('#lab-slide-status').textContent = `${
      state.activeSlide + 1
    } / ${slides.length}`;
    if (shouldScroll) {
      slideTrack.children[state.activeSlide].scrollIntoView({
        behavior: 'auto',
        block: 'nearest',
        inline: 'start',
      });
    }
    saveState();
  };
  document.querySelector('#lab-slide-prev').addEventListener('click', () => {
    state.activeSlide -= 1;
    renderSlide(true);
  });
  document.querySelector('#lab-slide-next').addEventListener('click', () => {
    state.activeSlide += 1;
    renderSlide(true);
  });

  const toastRegion = document.createElement('div');
  toastRegion.className = 'lab-toast-region';
  toastRegion.setAttribute('aria-live', 'polite');
  document.body.append(toastRegion);
  let toastTimer;
  const showToast = (kind) => {
    clearTimeout(toastTimer);
    state.toastCount += 1;
    state.lastToast = kind;
    saveState();
    document.querySelector(
      '#lab-toast-summary',
    ).textContent = `累计触发 ${state.toastCount} 次，最近：${kind}`;
    const toast = document.createElement('div');
    const text = document.createElement('span');
    const close = document.createElement('button');
    toast.className = 'lab-toast';
    toast.dataset.kind = kind;
    text.textContent = {
      success: '操作成功',
      warning: '请检查当前选择',
      error: '模拟操作失败',
    }[kind];
    close.type = 'button';
    close.textContent = '关闭';
    close.addEventListener('click', () => toast.remove());
    toast.append(text, close);
    toastRegion.replaceChildren(toast);
    toastTimer = setTimeout(() => toast.remove(), 2400);
  };
  root.querySelectorAll('[data-toast-kind]').forEach((button) => {
    button.addEventListener('click', () => showToast(button.dataset.toastKind));
  });

  const ITEM_HEIGHT = 48;
  const ITEM_COUNT = 200;
  const BUFFER = 3;
  const virtualList = document.querySelector('#lab-virtual-list');
  const virtualContent = document.querySelector('#lab-virtual-content');
  let renderedVirtualRange = [-1, -1];
  const renderVirtualList = () => {
    const start = Math.max(
      0,
      Math.floor(virtualList.scrollTop / ITEM_HEIGHT) - BUFFER,
    );
    const end = Math.min(
      ITEM_COUNT,
      Math.ceil(
        (virtualList.scrollTop + virtualList.clientHeight) / ITEM_HEIGHT,
      ) + BUFFER,
    );
    state.virtualRange = [start, end];
    document.querySelector('#lab-virtual-range').textContent = `当前渲染 ${
      start + 1
    }–${end} / ${ITEM_COUNT}`;
    if (renderedVirtualRange[0] === start && renderedVirtualRange[1] === end) {
      return;
    }
    renderedVirtualRange = [start, end];
    virtualContent.replaceChildren();
    virtualContent.style.paddingTop = `${start * ITEM_HEIGHT}px`;
    virtualContent.style.paddingBottom = `${
      (ITEM_COUNT - end) * ITEM_HEIGHT
    }px`;
    for (let index = start; index < end; index += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lab-virtual-item';
      button.dataset.virtualIndex = String(index);
      button.classList.toggle(
        'is-selected',
        state.selectedVirtualItem === index,
      );
      const number = String(index + 1).padStart(3, '0');
      button.textContent = `模拟医院 ${number}`;
      button.addEventListener('click', () => {
        state.selectedVirtualItem = index;
        document.querySelector(
          '#lab-virtual-selection',
        ).textContent = `已选择：模拟医院 ${number}`;
        saveState();
        virtualContent
          .querySelectorAll('[data-virtual-index]')
          .forEach((candidate) =>
            candidate.classList.toggle(
              'is-selected',
              candidate.dataset.virtualIndex === String(index),
            ),
          );
      });
      virtualContent.append(button);
    }
  };
  virtualList.addEventListener('scroll', renderVirtualList);

  const fileInput = document.querySelector('#lab-file');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    document.querySelector('#lab-file-status').textContent = file
      ? `文件：${file.name}｜${file.type || '未知类型'}｜${file.size} 字节`
      : '尚未选择文件';
  });
  document.querySelector('#lab-file-clear').addEventListener('click', () => {
    fileInput.value = '';
    document.querySelector('#lab-file-status').textContent = '尚未选择文件';
  });

  const hadSavedState = sessionStorage.getItem(STORAGE_KEY) !== null;
  document.querySelector('#lab-restore-status').textContent = hadSavedState
    ? '已恢复上次实验状态'
    : '当前为首次加载';
  document.querySelector('#lab-refresh').addEventListener('click', () => {
    saveState();
    location.reload();
  });
  document.querySelector('#lab-checkpoint').addEventListener('click', () => {
    window.DataInsights?.addCustomEvent('interaction-lab-checkpoint', {
      selectedTab: state.selectedTab,
      expandedPanelCount: state.expandedPanels.length,
      activeSlide: state.activeSlide,
      toastCount: state.toastCount,
      selectedVirtualItem: state.selectedVirtualItem,
      canvasStrokeCount: state.canvasStrokeCount,
      canvasCompleted: state.canvasCompleted,
      webglState: state.webglState,
      mediaPermissionState: state.mediaPermissionState,
    });
    showToast('success');
  });

  const canvasMount = document.querySelector('#lab-canvas-mount');
  const signatureCanvas = document.createElement('canvas');
  const canvasStatus = document.createElement('p');
  const canvasActions = document.createElement('div');
  const canvasClear = document.createElement('button');
  const canvasComplete = document.createElement('button');
  signatureCanvas.id = 'lab-signature-canvas';
  signatureCanvas.width = 640;
  signatureCanvas.height = 220;
  signatureCanvas.setAttribute('aria-label', 'Canvas 手写轨迹区域');
  canvasStatus.id = 'lab-canvas-status';
  canvasStatus.className = 'lab-status';
  canvasClear.type = 'button';
  canvasClear.id = 'lab-signature-clear';
  canvasClear.textContent = '清除';
  canvasComplete.type = 'button';
  canvasComplete.id = 'lab-signature-complete';
  canvasComplete.textContent = '完成轨迹';
  canvasActions.className = 'lab-actions';
  canvasActions.append(canvasClear, canvasComplete);
  canvasMount.append(signatureCanvas, canvasStatus, canvasActions);
  const canvasContext = signatureCanvas.getContext('2d');
  let drawing = false;
  const updateCanvasStatus = () => {
    canvasStatus.textContent = state.canvasCompleted
      ? `已完成 · ${state.canvasStrokeCount} 条轨迹`
      : `绘制中 · ${state.canvasStrokeCount} 条轨迹`;
  };
  const canvasPoint = (event) => {
    const bounds = signatureCanvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * signatureCanvas.width,
      y:
        ((event.clientY - bounds.top) / bounds.height) * signatureCanvas.height,
    };
  };
  signatureCanvas.addEventListener('pointerdown', (event) => {
    if (!canvasContext) return;
    drawing = true;
    state.canvasCompleted = false;
    state.canvasStrokeCount += 1;
    const point = canvasPoint(event);
    canvasContext.beginPath();
    canvasContext.moveTo(point.x, point.y);
    signatureCanvas.setPointerCapture(event.pointerId);
    updateCanvasStatus();
  });
  signatureCanvas.addEventListener('pointermove', (event) => {
    if (!drawing || !canvasContext) return;
    const point = canvasPoint(event);
    canvasContext.lineWidth = 4;
    canvasContext.lineCap = 'round';
    canvasContext.strokeStyle = '#ed6c24';
    canvasContext.lineTo(point.x, point.y);
    canvasContext.stroke();
  });
  const stopDrawing = () => {
    if (!drawing) return;
    drawing = false;
    saveState();
  };
  signatureCanvas.addEventListener('pointerup', stopDrawing);
  signatureCanvas.addEventListener('pointercancel', stopDrawing);
  canvasClear.addEventListener('click', () => {
    canvasContext?.clearRect(
      0,
      0,
      signatureCanvas.width,
      signatureCanvas.height,
    );
    state.canvasStrokeCount = 0;
    state.canvasCompleted = false;
    saveState();
    updateCanvasStatus();
  });
  canvasComplete.addEventListener('click', () => {
    state.canvasCompleted = true;
    saveState();
    updateCanvasStatus();
    window.DataInsights?.addCustomEvent('canvas-signature-completed', {
      strokeCount: state.canvasStrokeCount,
    });
  });
  updateCanvasStatus();

  const webglMount = document.querySelector('#lab-webgl-mount');
  const webglCanvas = document.createElement('canvas');
  const webglStatus = document.createElement('p');
  const webglActions = document.createElement('div');
  const webglStart = document.createElement('button');
  const webglPause = document.createElement('button');
  const webglReset = document.createElement('button');
  webglCanvas.id = 'lab-webgl-canvas';
  webglCanvas.width = 640;
  webglCanvas.height = 180;
  webglStatus.id = 'lab-webgl-status';
  webglStatus.className = 'lab-status';
  webglStart.id = 'lab-webgl-start';
  webglStart.type = 'button';
  webglStart.textContent = '开始';
  webglPause.id = 'lab-webgl-pause';
  webglPause.type = 'button';
  webglPause.textContent = '暂停';
  webglReset.id = 'lab-webgl-reset';
  webglReset.type = 'button';
  webglReset.textContent = '重置';
  webglActions.className = 'lab-actions';
  webglActions.append(webglStart, webglPause, webglReset);
  webglMount.append(webglCanvas, webglStatus, webglActions);
  const gl = webglCanvas.getContext('webgl');
  let webglFrame;
  let webglTick = 0;
  const renderWebglStatus = () => {
    webglStatus.textContent = gl
      ? `${
          state.webglState === 'running'
            ? '运行中'
            : state.webglState === 'paused'
            ? '已暂停'
            : '等待开始'
        } · 帧 ${webglTick}`
      : 'WebGL 不可用，已降级';
  };
  const drawWebgl = () => {
    if (!gl || state.webglState !== 'running') return;
    webglTick += 1;
    const wave = (Math.sin(webglTick / 18) + 1) / 2;
    gl.viewport(0, 0, webglCanvas.width, webglCanvas.height);
    gl.clearColor(0.95, 0.25 + wave * 0.35, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (webglTick % 10 === 0) renderWebglStatus();
    webglFrame = requestAnimationFrame(drawWebgl);
  };
  const pauseWebgl = () => {
    if (webglFrame) cancelAnimationFrame(webglFrame);
    webglFrame = undefined;
    if (gl) state.webglState = 'paused';
    saveState();
    renderWebglStatus();
  };
  webglStart.addEventListener('click', () => {
    if (!gl || state.webglState === 'running') return;
    state.webglState = 'running';
    saveState();
    renderWebglStatus();
    drawWebgl();
  });
  webglPause.addEventListener('click', pauseWebgl);
  webglReset.addEventListener('click', () => {
    if (webglFrame) cancelAnimationFrame(webglFrame);
    webglFrame = undefined;
    webglTick = 0;
    state.webglState = 'idle';
    if (gl) {
      gl.clearColor(0.96, 0.96, 0.96, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    saveState();
    renderWebglStatus();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.webglState === 'running') pauseWebgl();
  });
  renderWebglStatus();

  const iframeMount = document.querySelector('#lab-iframe-mount');
  const sameOriginFrame = document.createElement('iframe');
  const crossOriginFrame = document.createElement('iframe');
  const iframeStatus = document.createElement('p');
  const crossOrigin = `${location.protocol}//localhost:${location.port}`;
  sameOriginFrame.id = 'lab-same-origin-frame';
  sameOriginFrame.title = '同源 iframe 交互测试';
  sameOriginFrame.src = '/insurance/iframe-lab.html?mode=same-origin';
  crossOriginFrame.id = 'lab-cross-origin-frame';
  crossOriginFrame.title = '跨源 iframe 隔离测试';
  crossOriginFrame.src = `${crossOrigin}/insurance/iframe-lab.html?mode=cross-origin`;
  iframeStatus.id = 'lab-iframe-status';
  iframeStatus.className = 'lab-status';
  iframeStatus.textContent = '正在加载同源与跨源页面';
  let loadedFrames = 0;
  const markFrameLoaded = () => {
    loadedFrames += 1;
    iframeStatus.textContent =
      loadedFrames === 2 ? '同源与跨源页面均已加载' : '已加载 1 / 2';
  };
  sameOriginFrame.addEventListener('load', markFrameLoaded);
  crossOriginFrame.addEventListener('load', markFrameLoaded);
  iframeMount.append(sameOriginFrame, crossOriginFrame, iframeStatus);

  const pdfMount = document.querySelector('#lab-pdf-mount');
  const pdfFrame = document.createElement('iframe');
  pdfFrame.id = 'lab-pdf-frame';
  pdfFrame.title = '本地 PDF 阅读器模拟';
  pdfFrame.src = '/insurance/pdf-reader.html';
  pdfMount.append(pdfFrame);

  const mediaMount = document.querySelector('#lab-media-mount');
  const mediaCopy = document.createElement('p');
  const mediaStatus = document.createElement('p');
  const mediaSimulate = document.createElement('button');
  mediaCopy.textContent =
    '本组件不会申请摄像头或麦克风权限，只验证宿主页面展示授权结果。';
  mediaStatus.id = 'lab-media-status';
  mediaStatus.className = 'lab-status';
  mediaStatus.textContent = '未请求真实权限';
  mediaSimulate.id = 'lab-media-simulate';
  mediaSimulate.type = 'button';
  mediaSimulate.textContent = '模拟授权结果';
  mediaSimulate.addEventListener('click', () => {
    state.mediaPermissionState = 'simulated-granted';
    mediaStatus.textContent = '模拟授权完成（未调用真实媒体 API）';
    saveState();
  });
  mediaMount.append(mediaCopy, mediaStatus, mediaSimulate);

  if (state.selectedSuggestion) {
    document.querySelector(
      '#lab-selected-suggestion',
    ).textContent = `已选择：${state.selectedSuggestion}`;
  }
  document.querySelector(
    '#lab-toast-summary',
  ).textContent = `累计触发 ${state.toastCount} 次`;
  if (state.selectedVirtualItem !== null) {
    document.querySelector(
      '#lab-virtual-selection',
    ).textContent = `已选择：模拟医院 ${String(
      state.selectedVirtualItem + 1,
    ).padStart(3, '0')}`;
  }
  renderTabs();
  renderAccordions();
  renderSlide(false);
  renderVirtualList();
  window.__INTERACTION_LAB_READY__ = true;
})();
