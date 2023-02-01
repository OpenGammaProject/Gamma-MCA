/*

	Web Worker doing the Gaussian Correlation Filtering

*/

onmessage = e => {
	const data = e.data.data;
	const sigma = e.data.sigma;

	let correlValues: number[] = [];

    for (let index = 0; index < data.length; index++) {
      const std = Math.sqrt(index);
      const xMin = - Math.round(sigma * std);
      const xMax = Math.round(sigma * std);

      let gaussValues: number[] = [];
      for (let k = xMin; k < xMax; k++) {
        gaussValues.push(Math.exp(-(k**2) / (2 * index)));
      }

      let avg = 0;
      for (let i = 0; i < gaussValues.length; i++) {
        avg += gaussValues[i];
      }
      avg /= gaussValues.length;

      let squaredSum = 0;
      for (let i = 0; i < gaussValues.length; i++) {
        squaredSum += (gaussValues[i] - avg)**2;
      }

      let resultVal = 0;

      for(let k = xMin; k < xMax; k++) {
        resultVal += data[index + k] * (gaussValues[k - xMin] - avg) / squaredSum;
      }

      correlValues.push((resultVal && resultVal > 0 ) ? resultVal : 0);
    }
    postMessage(correlValues);
}