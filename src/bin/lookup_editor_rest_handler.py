"""
This controller provides helper methods to the front-end views that manage lookup files.
"""

import logging
import os
import sys
import csv
import json
import codecs

from splunk.appserver.mrsparkle.lib.util import make_splunkhome_path
from splunk import AuthorizationFailed, ResourceNotFound

from lookup_editor.exceptions import LookupFileTooBigException, PermissionDeniedException, LookupFileTooBigException
from lookup_editor import lookupfiles
from lookup_editor import settings

import rest_handler

if sys.platform == "win32":
    import msvcrt
    # Binary mode is required for persistent mode on Windows.
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stderr.fileno(), os.O_BINARY)

# The default of the csv module is 128KB; upping to 10MB. See SPL-12117 for
# the background on issues surrounding field sizes.
# (this method is new in python 2.5)
csv.field_size_limit(10485760)

def setup_logger(level):
    """
    Setup a logger for the REST handler.
    """

    logger = logging.getLogger('splunk.appserver.lookup_editor.rest_handler')
    logger.propagate = False # Prevent the log messages from being duplicated in the python.log file
    logger.setLevel(level)

    log_file_path = make_splunkhome_path(['var', 'log', 'splunk', 'lookup_editor_rest_handler.log'])
    file_handler = logging.handlers.RotatingFileHandler(log_file_path, maxBytes=25000000,
                                                        backupCount=5)

    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    return logger

logger = setup_logger(logging.INFO)

class LookupEditorHandler(rest_handler.RESTHandler):
    """
    This is the handler that supports editing lookup files.
    """

    def __init__(self, command_line, command_arg):
        super(LookupEditorHandler, self).__init__(command_line, command_arg, logger)

    def get_lookup_info(self, request_info, lookup_file=None, namespace="lookup_editor", **kwargs):
        return {
            'payload': str(lookup_file),  # Payload of the request.
            'status': 200                 # HTTP status code
            }

    def get_lookup_backups(self, request_info, lookup_file=None, namespace=None, owner=None, **kwargs):
        return {
            'payload': str(lookup_file),  # Payload of the request.
            'status': 200                 # HTTP status code
            } 

    def resolve_lookup_filename(self, lookup_file, namespace="lookup_editor", owner=None,
                                get_default_csv=True, version=None, throw_not_found=True,
                                session_key=None):
        """
        Resolve the lookup filename. This function will handle things such as:
         * Returning the default lookup file if requested
         * Returning the path to a particular version of a file

        Note that the lookup file must have an existing lookup file entry for this to return
        correctly; this shouldn't be used for determining the path of a new file.
        """

        # Strip out invalid characters like ".." so that this cannot be used to conduct an
        # directory traversal
        lookup_file = os.path.basename(lookup_file)
        namespace = os.path.basename(namespace)

        if owner is not None:
            owner = os.path.basename(owner)

        # Determine the lookup path by asking Splunk
        try:
            resolved_lookup_path = lookupfiles.SplunkLookupTableFile.get(lookupfiles.SplunkLookupTableFile.build_id(lookup_file, namespace, owner), sessionKey=session_key).path
        except ResourceNotFound:
            if throw_not_found:
                raise
            else:
                return None

        # Get the backup file for one without an owner
        if version is not None and owner is not None:
            lookup_path = make_splunkhome_path([self.getBackupDirectory(lookup_file, namespace, owner, resolved_lookup_path=resolved_lookup_path), version])
            lookup_path_default = make_splunkhome_path(["etc", "users", owner, namespace,
                                                        "lookups", lookup_file + ".default"])

        # Get the backup file for one with an owner
        elif version is not None:
            lookup_path = make_splunkhome_path([self.getBackupDirectory(lookup_file, namespace, owner, resolved_lookup_path=resolved_lookup_path), version])
            lookup_path_default = make_splunkhome_path(["etc", "apps", namespace, "lookups",
                                                        lookup_file + ".default"])

        # Get the user lookup
        elif owner is not None and owner != 'nobody':
            # e.g. $SPLUNK_HOME/etc/users/luke/SA-NetworkProtection/lookups/test.csv
            lookup_path = resolved_lookup_path
            lookup_path_default = make_splunkhome_path(["etc", "users", owner, namespace,
                                                        "lookups", lookup_file + ".default"])

        # Get the non-user lookup
        else:
            lookup_path = resolved_lookup_path
            lookup_path_default = make_splunkhome_path(["etc", "apps", namespace, "lookups",
                                                        lookup_file + ".default"])

        self.logger.info('Resolved lookup file, path=%s', lookup_path)

        # Get the file path
        if get_default_csv and not os.path.exists(lookup_path) and os.path.exists(lookup_path_default):
            return lookup_path_default
        else:
            return lookup_path

    def get_lookup_contents(self, request_info, lookup_file=None, namespace="lookup_editor",
                             owner=None, header_only=False, version=None, lookup_type=None,
                             **kwargs):
        """
        Provides the contents of a lookup file as JSON.
        """

        self.logger.info("Retrieving lookup contents, namespace=%s, lookup=%s, type=%s, owner=%s,"
                         " version=%s", namespace, lookup_file, lookup_type, owner, version)

        if lookup_type is None or len(lookup_type) == 0:
            lookup_type = "csv"
            self.logger.warning("No type for the lookup provided when attempting to load a lookup" +
                                " file, it will default to CSV")

        if header_only in ["1", "true", 1, True]:
            header_only = True
        else:
            header_only = False

        try:

            # Load the KV store lookup
            if lookup_type == "kv":
                return self.render_json(self.get_kv_lookup(lookup_file, namespace, owner))

            # Load the CSV lookup
            elif lookup_type == "csv":

                with self.get_lookup(request_info.session_key, lookup_file, namespace, owner, version=version,
                                     throw_exception_if_too_big=True) as csv_file:

                    csv_reader = csv.reader(csv_file)

                    # Convert the content to JSON
                    lookup_contents = []

                    for row in csv_reader:
                        lookup_contents.append(row)

                        # If we are only loading the header, then stop here
                        if header_only:
                            break

                    return self.render_json(lookup_contents)

            else:
                self.logger.warning('Lookup file type is not recognized,' +
                                    ' lookup_type=' + lookup_type)
                return self.render_error_json('Lookup file type is not recognized', 421)

        except IOError:
            self.logger.warning("Unable to find the requested lookup")
            return self.render_error_json("Unable to find the lookup", 404)

        except (AuthorizationFailed, PermissionDeniedException) as e:
            self.logger.warning("Access to lookup denied")
            return self.render_error_json(str(e), 403)

        except LookupFileTooBigException as e:
            self.logger.warning("Lookup file is too large to load")

            data = {
                'message': 'Lookup file is too large to load' +
                           '(file-size must be less than 10 MB to be edited)',
                'file_size' : e.file_size
            }

            return {
                'payload': json.dumps(data),
                'status': 420
            }
        except:
            self.logger.exception('Lookup file could not be loaded')
            return self.render_error_json('Lookup file could not be loaded', 500)

        return {
            'payload': 'Response',
            'status': 500
        }

    def get_lookup_as_file(self, request_info, lookup_file=None, namespace="lookup_editor", **kwargs):
        return {
            'payload': str(lookup_file),  # Payload of the request.
            'status': 200                 # HTTP status code
            }


    def post_lookup_contents(self, request_info, lookup_file=None, namespace="lookup_editor",
                             owner=None, header_only=False, version=None, lookup_type=None,
                             **kwargs):
        return {
            'payload': str(lookup_file),  # Payload of the request.
            'status': 200                 # HTTP status code
            }

    def get_lookup(self, session_key, lookup_file, namespace="lookup_editor", owner=None, get_default_csv=True,
                   version=None, throw_exception_if_too_big=False):
        """
        Get a file handle to the associated lookup file.
        """

        self.logger.debug("Version is:" + str(version))

        # Check capabilities
        #LookupEditor.check_capabilities(lookup_file, user, session_key)

        # Get the file path
        file_path = self.resolve_lookup_filename(lookup_file, namespace, owner, get_default_csv,
                                                 version, session_key=session_key)

        if throw_exception_if_too_big:

            try:
                file_size = os.path.getsize(file_path)

                self.logger.info('Size of lookup file determined, file_size=%s, path=%s',
                                 file_size, file_path)

                if file_size > settings.MAXIMUM_EDITABLE_SIZE:
                    raise LookupFileTooBigException(file_size)

            except os.error:
                self.logger.exception("Exception generated when attempting to determine size of " +
                                      "requested lookup file")

        self.logger.info("Loading lookup file from path=%s", file_path)

        # Get the file handle
        # Note that we are assuming that the file is in UTF-8. Any characters that don't match
        # will be replaced.
        return codecs.open(file_path, 'rb', encoding='utf-8', errors='replace')