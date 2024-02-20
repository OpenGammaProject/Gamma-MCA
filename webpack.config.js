const path = require('path');

module.exports = {
  entry: {
    main: './source/main.ts', // Adjust the entry point to your main TypeScript file
    notFound: './source/404.ts', // Add an entry point for 404.ts
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/dist',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  devServer: {
    static: './',
    liveReload: false,
    hot: false,
  },
  mode: 'production',
  devtool: 'source-map',
  performance: {
    hints: false,
  },
};
