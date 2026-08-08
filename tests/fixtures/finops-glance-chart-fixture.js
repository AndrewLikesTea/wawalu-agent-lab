// Labelled executable fixture for issue #1348. These are the four published
// readings from loadExampleDataset() plus its reproducible peer ranking. Exact
// strings are intentional: the assumption is that SVG viewBox coordinates are
// part of the explainable model-to-picture contract, not visual approximations.
export const FINOPS_GLANCE_CHART_FIXTURE = Object.freeze({
  label: "bundled example · finops-glance/1.0.0",
  figures: Object.freeze({
    spendMix: Object.freeze({
      series: [0.4697230769230769, 0.21283076923076924, 0.24206153846153847, 0.07538461538461538],
      shapes: [
        ["RECT", "6", "3", "48", "6", "0.12"],
        ["RECT", "6", "3", "21.94670769230769", "6", "0.95"],
        ["RECT", "28.54670769230769", "3", "9.615876923076923", "6", "0.28"],
        ["RECT", "38.76258461538461", "3", "11.018953846153847", "6", "0.28"],
        ["RECT", "50.381538461538454", "3", "3.0184615384615383", "6", "0.28"],
      ],
    }),
    departmentRank: Object.freeze({
      series: [79000, 24500, 22000, 18000, 11000],
      shapes: [
        ["RECT", "6", "0.5", "48", "2", "0.12"], ["RECT", "6", "0.5", "48", "2", "0.95"],
        ["RECT", "6", "3.5", "48", "2", "0.12"], ["RECT", "6", "3.5", "14.886075949367088", "2", "0.28"],
        ["RECT", "6", "6.5", "48", "2", "0.12"], ["RECT", "6", "6.5", "13.367088607594937", "2", "0.28"],
        ["RECT", "6", "9.5", "48", "2", "0.12"], ["RECT", "6", "9.5", "10.936708860759493", "2", "0.28"],
      ],
    }),
    movement: Object.freeze({
      series: [115300, 154500],
      shapes: [["POLYLINE", "6,10.5 54,1.5"], ["CIRCLE", "54", "1.5", "1.75", "0.95"]],
    }),
    peerPosition: Object.freeze({
      series: [4],
      shapes: [
        ["RECT", "6.6", "3", "10.8", "6", "0.12"], ["RECT", "18.6", "3", "10.8", "6", "0.12"],
        ["RECT", "30.6", "3", "10.8", "6", "0.12"], ["RECT", "42.6", "3", "10.8", "6", "0.95"],
      ],
    }),
  }),
});
