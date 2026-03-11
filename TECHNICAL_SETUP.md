# Technical Setup Guide for Reactor Simulator

## HTML5 Export Configuration
Here are the steps to configure your HTML5 export settings:
1. Open your project in the editor.
2. Navigate to the **Export** menu.
3. Select **HTML5**, and then choose your export options:
   - Set the **Width** and **Height** of the export.
   - Choose **Textures** and **Audio** options based on your needs.
4. Click on **Export Project**.

## GitHub Actions CI/CD Setup
To set up Continuous Integration and Continuous Delivery (CI/CD) with GitHub Actions, follow these steps:
1. Create a file under `.github/workflows/main.yml`:
   ```yaml
   name: CI/CD

   on:
     push:
       branches:
         - main

   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
       - name: Checkout code
         uses: actions/checkout@v2

       - name: Set up Node.js
         uses: actions/setup-node@v2
         with:
           node-version: '14'

       - name: Install dependencies
         run: |
           npm install

       - name: Build project
         run: |
           npm run build

       - name: Deploy
         run: |
           npm run deploy
   ```

## Build Instructions
To build the project locally:
1. Clone the repository:
   ```bash
   git clone https://github.com/thenuker123/Reactor-simulator.git
   cd Reactor-simulator
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Performance Optimization Tips for Web Deployment
1. **Minimize Asset Size**: Compress images and minify CSS and JavaScript files.
2. **Leverage Caching**: Use browser cache and CDN to serve static assets.
3. **Optimize Load Time**: Reduce HTTP requests and use asynchronous loading for scripts.
4. **Responsive Images**: Use `srcset` for images to serve different sizes based on the device.
5. **Use Web Workers**: Offload heavy computations to web workers to keep the UI responsive.

Following these guidelines will help ensure that your application performs optimally in a web environment.