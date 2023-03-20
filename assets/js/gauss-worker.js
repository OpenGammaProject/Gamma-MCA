"use strict";
onmessage = e => {
    const data = e.data.data;
    const sigma = e.data.sigma;
    postMessage(gaussianCorrel(data, sigma));
};
function gaussianCorrel(data, sigma = 2) {
    const correlValues = [];
    for (let index = 0; index < data.length; index++) {
        const std = Math.sqrt(index);
        const xMin = -Math.round(sigma * std);
        const xMax = Math.round(sigma * std);
        const gaussValues = [];
        for (let k = xMin; k < xMax; k++) {
            gaussValues.push(Math.exp(-(k ** 2) / (2 * index)));
        }
        let avg = 0;
        for (const value of gaussValues) {
            avg += value;
        }
        avg /= xMax - xMin;
        let squaredSum = 0;
        for (const value of gaussValues) {
            squaredSum += (value - avg) ** 2;
        }
        let resultVal = 0;
        for (let k = xMin; k < xMax; k++) {
            resultVal += data[index + k] * (gaussValues[k - xMin] - avg) / squaredSum;
        }
        const value = (resultVal && resultVal > 0) ? resultVal : 0;
        correlValues.push(value);
    }
    const scalingFactor = .8 * Math.max(...data) / Math.max(...correlValues);
    correlValues.forEach((value, index, array) => array[index] = value * scalingFactor);
    return correlValues;
}
//# sourceMappingURL=gauss-worker.js.map