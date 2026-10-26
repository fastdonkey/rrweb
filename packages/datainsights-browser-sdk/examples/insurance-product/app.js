(() => {
  const plans = {
    basic: { label: '惠选版', price: '9.17', medicine: '最高80万元' },
    premium: { label: '优享版', price: '16.58', medicine: '最高100万元' },
  };
  let selectedPlan = 'basic';

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
      const submitButton = document.querySelector('#submit-policy');
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
