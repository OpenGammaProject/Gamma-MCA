#
# This little script launches a webserver on your local machine
# for you to use Gamma MCA if you encounter any problems with the
# default approach of using it over the internet.
#
# You can change the port by adjusting the PORT value.
# No need to install any packages except for Python 3.
#
# NuclearPhoenix, 2023. Gamma MCA.
#

from http.server import SimpleHTTPRequestHandler, HTTPServer

PORT = 80

Handler = SimpleHTTPRequestHandler
httpd = HTTPServer(("localhost", PORT), Handler)

print(f"Serving on http://localhost:{PORT}")
httpd.serve_forever()
