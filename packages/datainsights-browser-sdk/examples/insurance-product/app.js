(() => {
  const plans = {
    basic: { label: '惠选版', price: '9.17', medicine: '最高80万元' },
    premium: { label: '优享版', price: '16.58', medicine: '最高100万元' },
  };
  let selectedPlan = 'basic';
  const insuranceNotices = [
    {
      code: 'application-notice',
      title: '投保须知',
      version: 'v1.0',
      summary: '了解投保资格、等待期与如实告知义务',
      sections: [
        [
          '投保资格',
          '本页面仅用于本地录制验证。投保人应确认年龄、身份和保障需求等基本信息，并理解最终承保结果应以保险机构正式审核为准。',
        ],
        [
          '如实告知',
          '填写投保信息时应根据页面询问如实作答，不应隐瞒或遗漏可能影响承保判断的重要情况。模拟页面不会把这些内容发送到生产系统。',
        ],
        [
          '等待期说明',
          '不同保险责任可能设置不同等待期。等待期内发生的情形是否承担责任，应以正式产品条款和投保页面展示的信息为准。',
        ],
        [
          '重要提示',
          '请结合自身需求阅读保险责任、责任免除、理赔材料和退保规则。本模拟文件用于逐项说明和录制回放测试，不构成销售承诺。',
        ],
      ],
    },
    {
      code: 'policy-terms',
      title: '保险条款',
      version: 'v1.0',
      summary: '查看保障责任、责任免除与理赔约定',
      sections: [
        [
          '保障责任',
          '模拟保障包括合理且必要的医疗费用、特定药品费用和约定服务。具体责任范围、给付比例与限额应以正式保险合同为准。',
        ],
        [
          '保险期间',
          '保险期间、续保条件和保险费支付方式需要在正式投保时单独确认。本页面仅展示用于录制验证的示例描述。',
        ],
        [
          '保险金申请',
          '发生保险事故后通常需要提交身份证明、诊断资料、费用凭证及保险机构合理要求的其他材料，并配合真实性核验。',
        ],
        [
          '合同解释',
          '条款标题只用于阅读便利，不改变正文含义。存在疑问时应通过保险机构正式服务渠道获取解释，不以本地 Demo 作为依据。',
        ],
      ],
    },
    {
      code: 'health-disclosure',
      title: '健康告知',
      version: 'v1.0',
      summary: '确认健康状况相关问询与说明',
      sections: [
        [
          '告知目的',
          '健康告知用于帮助保险机构评估风险。投保人应由本人或在获得合法授权后，根据被保险人的真实健康情况回答页面问题。',
        ],
        [
          '就医与诊断',
          '如页面询问既往诊断、住院、手术、用药或检查异常，应按照问题限定的时间和范围作答，不应自行扩大或缩小问题含义。',
        ],
        [
          '不确定事项',
          '对诊断名称、检查结果或治疗记录不确定时，应先查询既有资料或咨询专业人员，再继续正式投保流程。',
        ],
        [
          '测试边界',
          '本地 Demo 不收集真实健康信息，也不作承保判断。本模拟文件用于逐项说明和录制回放测试，请勿填写真实敏感病史。',
        ],
      ],
    },
    {
      code: 'exemption-clauses',
      title: '免责条款',
      version: 'v1.0',
      summary: '重点阅读不承担保险责任的情形',
      sections: [
        [
          '责任免除',
          '故意行为、违法犯罪、未遵医嘱使用药物以及正式条款列明的其他情形，可能不属于保险责任范围。实际内容以正式条款为准。',
        ],
        [
          '既往情况',
          '部分产品可能对投保前已存在的疾病、症状或治疗作出特别约定。投保时应结合健康告知和责任免除内容一并理解。',
        ],
        [
          '费用限制',
          '超出约定医院、治疗方式、药品目录、给付比例或责任限额的费用，可能无法获得全部赔付。',
        ],
        [
          '确认说明',
          '点击确认仅表示在本地测试中完成阅读动作，不代表签署真实保险合同，也不产生保险保障或缴费义务。',
        ],
      ],
    },
    {
      code: 'privacy-authorization',
      title: '个人信息处理授权书',
      version: 'v1.0',
      summary: '了解个人信息处理目的、范围和权利',
      sections: [
        [
          '处理目的',
          '正式保险服务可能为投保审核、保全、理赔、客户服务和风险管理处理必要的个人信息，并应遵循合法、正当、必要原则。',
        ],
        [
          '信息范围',
          '信息范围可能包括身份、联系方式、投保资料和依法取得的其他必要信息。密码、认证令牌等安全凭证不属于本 Demo 的录制内容。',
        ],
        [
          '保存与保护',
          '正式业务应依据适用规则设置保存期限、访问权限和安全措施。本地 Demo 的录制数据仅用于验证 DataInsights 能力。',
        ],
        [
          '个人权利',
          '个人可以依据适用规则申请查阅、更正或删除相关信息，也可以通过正式服务渠道了解处理规则。本页面不连接生产服务。',
        ],
      ],
    },
  ];
  const confirmedNoticeCodes = new Set();
  const confirmationOrder = [];
  let activeNoticeCode;
  let activeNoticeTrigger;
  let noticesEventSent = false;

  const noticeList = document.querySelector('#insurance-notice-list');
  const noticeStatus = document.querySelector('#notice-confirmation-status');
  const noticeModal = document.querySelector('#insurance-notice-modal');
  const noticeTitle = document.querySelector('#insurance-notice-title');
  const noticeVersion = document.querySelector('#insurance-notice-version');
  const noticeContent = document.querySelector('#insurance-notice-content');
  const noticeReadHint = document.querySelector('#insurance-notice-read-hint');
  const confirmNoticeButton = document.querySelector(
    '#confirm-insurance-notice',
  );
  const submitButton = document.querySelector('#submit-policy');

  const updateNoticeGate = () => {
    const remaining = insuranceNotices.length - confirmedNoticeCodes.size;
    noticeStatus.textContent =
      remaining === 0 ? '已完成全部阅读确认' : `还需确认 ${remaining} 项`;
    submitButton.disabled = remaining !== 0;
    insuranceNotices.forEach(({ code }) => {
      const button = noticeList.querySelector(
        `[data-insurance-notice="${code}"]`,
      );
      const confirmed = confirmedNoticeCodes.has(code);
      button.classList.toggle('is-confirmed', confirmed);
      button.dataset.confirmed = String(confirmed);
      const order = confirmationOrder.indexOf(code);
      if (order >= 0) {
        button.dataset.confirmationOrder = String(order + 1);
      } else {
        delete button.dataset.confirmationOrder;
      }
      button.querySelector('.insurance-notice-item__state').textContent =
        confirmed ? `已确认 · 第 ${order + 1} 项` : '点击阅读';
    });
  };

  const updateNoticeReadiness = () => {
    const reachedBottom =
      noticeContent.scrollHeight -
        noticeContent.scrollTop -
        noticeContent.clientHeight <=
      2;
    confirmNoticeButton.disabled = !reachedBottom;
    noticeReadHint.textContent = reachedBottom
      ? '已阅读至底部，可以确认'
      : '请继续向下阅读';
    noticeReadHint.classList.toggle('is-complete', reachedBottom);
  };

  const closeNotice = () => {
    noticeModal.hidden = true;
    document.body.classList.remove('has-reading-modal');
    const trigger = activeNoticeTrigger;
    activeNoticeCode = undefined;
    activeNoticeTrigger = undefined;
    trigger?.focus();
  };

  const openNotice = (code, trigger) => {
    const notice = insuranceNotices.find(
      (candidate) => candidate.code === code,
    );
    if (!notice) return;
    activeNoticeCode = code;
    activeNoticeTrigger = trigger;
    noticeTitle.textContent = notice.title;
    noticeVersion.textContent = `本地模拟文件 · ${notice.version}`;
    noticeContent.replaceChildren();
    notice.sections.forEach(([heading, body]) => {
      const section = document.createElement('section');
      const title = document.createElement('h3');
      const paragraph = document.createElement('p');
      title.textContent = heading;
      paragraph.textContent = body;
      section.append(title, paragraph);
      noticeContent.append(section);
    });
    confirmNoticeButton.disabled = true;
    noticeReadHint.textContent = '请继续向下阅读';
    noticeReadHint.classList.remove('is-complete');
    noticeModal.hidden = false;
    document.body.classList.add('has-reading-modal');
    noticeContent.scrollTop = 0;
    updateNoticeReadiness();
    noticeContent.focus();
  };

  insuranceNotices.forEach(({ code, title, summary }) => {
    const button = document.createElement('button');
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    const description = document.createElement('small');
    const state = document.createElement('span');
    button.type = 'button';
    button.className = 'insurance-notice-item';
    button.dataset.insuranceNotice = code;
    button.dataset.confirmed = 'false';
    copy.className = 'insurance-notice-item__copy';
    name.textContent = title;
    description.textContent = summary;
    state.className = 'insurance-notice-item__state';
    state.textContent = '点击阅读';
    copy.append(name, description);
    button.append(copy, state);
    button.addEventListener('click', () => openNotice(code, button));
    noticeList.append(button);
  });

  noticeContent.addEventListener('scroll', updateNoticeReadiness);
  document
    .querySelector('#close-insurance-notice')
    .addEventListener('click', closeNotice);
  confirmNoticeButton.addEventListener('click', () => {
    if (!activeNoticeCode || confirmNoticeButton.disabled) return;
    if (!confirmedNoticeCodes.has(activeNoticeCode)) {
      confirmedNoticeCodes.add(activeNoticeCode);
      confirmationOrder.push(activeNoticeCode);
      updateNoticeGate();
    }
    if (
      confirmedNoticeCodes.size === insuranceNotices.length &&
      !noticesEventSent
    ) {
      noticesEventSent = true;
      window.DataInsights.addCustomEvent('insurance-notices-confirmed', {
        noticeVersion: 'local-insurance-notices-v1',
        documentCodes: insuranceNotices.map(({ code }) => code),
        confirmationOrder: [...confirmationOrder],
      });
    }
    closeNotice();
  });
  updateNoticeGate();

  const showInsuranceForm = () => {
    const formSection = document.querySelector('#insurance-form');
    formSection.hidden = false;
    formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const selectPlan = (planName) => {
    selectedPlan = planName;
    document.querySelectorAll('[data-plan]').forEach((button) => {
      const selected = button.dataset.plan === planName;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
    const plan = plans[planName];
    document.querySelector('#hero-price').textContent = plan.price;
    document.querySelector('#selected-plan-price').textContent = plan.price;
    document.querySelector('#selected-plan-label').textContent = plan.label;
    document.querySelector('#medicine-limit').textContent = plan.medicine;
  };

  document.querySelectorAll('[data-plan]').forEach((button) => {
    button.addEventListener('click', () => selectPlan(button.dataset.plan));
  });

  document.querySelectorAll('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.querySelector(`#${button.dataset.scrollTarget}`);
      if (target?.id === 'insurance-form') target.hidden = false;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.querySelectorAll('.faq-question').forEach((button) => {
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      button.querySelector('span').textContent = expanded ? '⌄' : '⌃';
      button.nextElementSibling.hidden = expanded;
    });
  });

  const coverageModal = document.querySelector('#coverage-modal');
  document.querySelector('#coverage-details').addEventListener('click', () => {
    coverageModal.hidden = false;
  });
  document
    .querySelector('#close-coverage-modal')
    .addEventListener('click', () => {
      coverageModal.hidden = true;
    });

  document
    .querySelector('#start-insurance')
    .addEventListener('click', showInsuranceForm);
  document
    .querySelector('#hero-apply')
    .addEventListener('click', showInsuranceForm);

  document.querySelector('#consent-recording').addEventListener('click', () => {
    document.querySelector('.recording-consent')?.remove();
  });

  document
    .querySelector('#policy-form')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      if (confirmedNoticeCodes.size !== insuranceNotices.length) {
        updateNoticeGate();
        return;
      }
      submitButton.disabled = true;
      submitButton.textContent = '正在保存录制…';

      window.DataInsights.addCustomEvent('policy-submit', {
        plan: selectedPlan,
        source: 'local-zhongan-fidelity-demo',
      });

      window.__SUBMIT_RESULT__ = window.DataInsights.stop('completed');
      const result = await window.__SUBMIT_RESULT__;
      if (result.ok) {
        document.querySelector('#application-success').hidden = false;
        submitButton.textContent = '投保信息已提交';
        return;
      }

      submitButton.disabled = false;
      submitButton.textContent = '重新提交投保信息';
    });

  window.__BOOTSTRAP_RESULT__ = window.DataInsights.bootstrap({
    appKey: 'di_t_cn1_LOCALDEMO1',
    consent: {
      startSelector: '#consent-recording',
      noticeVersion: 'insurance-sales-replay-v2',
    },
    resolveUserId: () => 'local-insurance-user-001',
  });
  window.__INSURANCE_APP_READY__ = true;
})();
