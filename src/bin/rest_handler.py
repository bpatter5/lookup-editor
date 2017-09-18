
import json

from splunk.persistconn.application import PersistentServerConnectionApplication

class RequestInfo(object):
    """
    This represents the request.
    """

    def __init__(self, user, session_key, method, path, query, raw_args):
        self.user = user
        self.session_key = session_key
        self.method = method
        self.path = path
        self.query = query
        self.raw_args = raw_args

class RESTHandler(PersistentServerConnectionApplication):
    """
    This is a REST handler base-class that makes implementing a REST handler easier.
    
    This works by resolving a name based on the path in the HTTP request and calls it. This class
    will look for a function that includes the HTTP verb followed by the path.abs
    
    For example, if a GET request is made to the endpoint is executed with the path
    /lookup_edit/lookup_contents, then this class will attempt to run a function named
    get_lookup_contents(). Note that the root path of the REST handler is removed.

    If a POSt request is made to the endpoint is executed with the path
    /lookup_edit/lookup_contents, the this class will attempt to execute post_lookup_contents().

    The arguments to the function will be the following:

      * request_info (an instance of RequestInfo)
      * keyword arguments (**kwargs)
    """

    def __init__(self, command_line, command_arg, logger=None):
        self.logger = logger
        PersistentServerConnectionApplication.__init__(self)

    @classmethod
    def get_function_signature(cls, method, path):
        """
        Get the function that should be called based on path and request method.
        """

        if len(path) > 0:
            return method + "_" + path
        else:
            return method

    def render_json(self, data, response_code=200):
        """
        Render the data as JSON
        """

        return {
            'payload': json.dumps(data),
            'status': response_code
        }

    def render_error_json(self, message, response_code=500):
        """
        Render an error to be returned to the client.
        """

        data = {
            'success' : False,
            'message' : message
        }

        return {
            'payload': json.dumps(data),
            'status': response_code
        }

    def handle(self, in_string):
        self.logger.info("Handling a request")

        # Parse the arguments
        args = self.parse_in_string(in_string)

        # Get the user information
        session_key = args['session']['authtoken']
        user = args['session']['user']

        # Get the method
        method = args['method']

        # Get the path and the args
        path = args['path_info']
        query = args['query_parameters']

        # Make the request info object
        request_info = RequestInfo(user, session_key, method, path, query, args)

        """
        if method == 'get':
            self.do_get(path, user, session_key, **query)
        """

        # Get the function signature
        function_name = self.get_function_signature(method, path)

        try:
            function_to_call = getattr(self, function_name)
        except AttributeError:
            function_to_call = None

        # Try to run the function
        if function_to_call is not None:
            if self.logger is not None:
                self.logger.info("Executing function, name=%s", function_name)

            # Execute the function
            return function_to_call(request_info, **query)
        else:
            if self.logger is not None:
                self.logger.warn("A request could not be executed since the associated function " +
                                 "is missing, name=%s", function_name)

            return {
                'payload': 'Path was not found',
                'status': 404
            }  

    def do_get(self, path, user, session_key, **kwargs):
        pass

    def convert_to_dict(self, query):
        """
        Create a dictionary containing the parameters.
        """
        parameters = {}

        for key, val in query:

            # If the key is already in the list, but the existing entry isn't a list then make the
            # existing entry a list and add thi one
            if key in parameters and not isinstance(parameters[key], list):
                parameters[key] = [parameters[key], val]

            # If the entry is already included as a list, then just add the entry
            elif key in parameters:
                parameters[key].append(val)

            # Otherwise, just add the entry
            else:
                parameters[key] = val

        return parameters

    def parse_in_string(self, in_string):
        """
        Parse the in_string
        """

        params = json.loads(in_string)

        params['method'] = params['method'].lower()

        params['form_parameters'] = self.convert_to_dict(params.get('form', []))
        params['query_parameters'] = self.convert_to_dict(params.get('query', []))

        return params
