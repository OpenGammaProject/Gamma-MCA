/*

	Web Worker doing the Gaussian Correlation Filtering

*/

onmessage = e => {
	const data = e.data.data;
	const sigma = e.data.sigma;

  postMessage(gaussianCorrel(data, sigma));
}


function gaussianCorrel(data: number[], sigma = 2): number[] {
  const correlValues: number[] = [];

  for (let index = 0; index < data.length; index++) {
    const std = Math.sqrt(index);
    const xMin = - Math.round(sigma * std);
    const xMax = Math.round(sigma * std);

    const gaussValues: number[] = [];
    for (let k = xMin; k < xMax; k++) {
      gaussValues.push(Math.exp(-(k**2) / (2 * index)));
    }

    let avg = 0;
    for (const value of gaussValues) {
      avg += value;
    }
    avg /= xMax - xMin;

    let squaredSum = 0;
    for (const value of gaussValues) {
      squaredSum += (value - avg)**2;
    }

    let resultVal = 0;

    for(let k = xMin; k < xMax; k++) {
      resultVal += data[index + k] * (gaussValues[k - xMin] - avg) / squaredSum;
    }

    const value = (resultVal && resultVal > 0 ) ? resultVal : 0;
    correlValues.push(value);
  }

  const scalingFactor = .8 * Math.max(...data) / Math.max(...correlValues); // Scale GCF values depending on the spectrum data
  correlValues.forEach((value, index, array) => array[index] = value * scalingFactor);

  return correlValues;
}
