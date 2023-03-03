/*
	Type definitions for Polynomial Regression
*/

export default class Matrix {
    backwardSubstitution(anyMatrix: number[][], arr: number[], row: number, col: number): number[];
    combineMatrices (left: number, right: number): number[][];
    forwardElimination(anyMatrix: number[][]): number[][];
    gaussianJordanElimination(leftMatrix: number[][], rightMatrix: number[][]): number[];
    identityMatrix (anyMatrix: number[][]): number[][];
    matrixProduct (matrix1: number[][], matrix2: number[][]): number[][];
    doMultiplication (matrix1: number[][], matrix2: number[][], row: number, col: number, numCol: number): number;
    multiplyRow (anyMatrix: number[][], rowNum: number, multiplier: number): number[][];
}