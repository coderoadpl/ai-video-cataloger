import eventSuffixTaxonomy from './rules/event-suffix-taxonomy.js';
import queryDescriptorsOnly from './rules/query-descriptors-only.js';

export default {
  meta: { name: 'eslint-plugin-avc', version: '0.0.0' },
  rules: {
    'event-suffix-taxonomy': eventSuffixTaxonomy,
    'query-descriptors-only': queryDescriptorsOnly,
  },
};
