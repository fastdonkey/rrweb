(() => {
  const plans = {
    basic: { label: '基础版', price: '18.00' },
    premium: { label: '尊享版', price: '32.00' },
  };
  let selectedPlan = 'basic';

  const selectPlan = (planName) => {
    selectedPlan = planName;
    document.querySelectorAll('[data-plan]').forEach((button) => {
      const selected = button.dataset.plan === planName;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
    const plan = plans[planName];
    document.querySelector('#hero-price').textContent = plan.price;
    document.querySelector('#selected-plan-label').textContent = `${
      plan.label
    } · ¥${Number(plan.price)}/月`;
  };

  document.querySelectorAll('[data-plan]').forEach((button) => {
    button.addEventListener('click', () => selectPlan(button.dataset.plan));
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

  document.querySelector('#start-insurance').addEventListener('click', () => {
    const application = document.querySelector('#application');
    application.hidden = false;
    application.scrollIntoView({ behavior: 'auto', block: 'start' });
  });

  document
    .querySelector('#policy-form')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = document.querySelector('#submit-policy');
      submitButton.disabled = true;
      submitButton.textContent = '正在保存录制…';

      window.DataInsights.addCustomEvent('policy-submit', {
        plan: selectedPlan,
        source: 'local-insurance-demo',
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
      startSelector: '#start-insurance',
      noticeVersion: 'insurance-sales-replay-v1',
    },
    resolveUserId: () => 'local-insurance-user-001',
  });
  window.__INSURANCE_APP_READY__ = true;
})();
