// PATH
const path = require('path');

// PLUGIN
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const AutoprefixerPlugin = require('autoprefixer');

module.exports = {
  entry: {
    main: './source/main.ts', // Adjust the entry point to your main TypeScript file
    notFound: './source/404.ts', // Add an entry point for 404.ts
  },
  plugins: [new MiniCssExtractPlugin()],
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist/'),
    publicPath: '/dist/',
    clean: true,
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
      {
        test: /\.(scss)$/,
        use: [
          {
            // Extracts CSS for each JS file that includes CSS
            loader: MiniCssExtractPlugin.loader,
          },
          {
            loader: 'css-loader',
          },
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: () => [AutoprefixerPlugin],
              },
            },
          },
          {
            loader: 'sass-loader',
          },
        ],
      },
    ],
  },
  optimization: {
    minimizer: [
      // Extend existing minimizers (i.e. `terser-webpack-plugin`)
      '...',
      new CssMinimizerPlugin(),
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
