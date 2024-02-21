/*
	Type definitions for Polynomial Regression
*/

import DataPoint from './DataPoint.min.js';

type InputDataPoint = {
	x: number,
	y: number
}

export default class PolynomialRegression {
    static read(list: InputDataPoint[], degrees: number): PolynomialRegression;
    constructor(data_points: DataPoint[], degrees: number);
    sumX (anyData: number[], power: number): number;
    sumXTimesY(anyData: number[], power: number): number;
    sumY (anyData: number[], power: number): number;
    generateLeftMatrix(): void;
    generateRightMatrix(): void;
    getTerms(): number[];
    predictY(terms: number[], x: number): number;
}